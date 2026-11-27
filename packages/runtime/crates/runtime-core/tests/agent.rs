//! The tests of `packages/runtime-legacy/src/worker/core/agent.test.ts`, ported
//! to the Rust core. Same names, same expectations: a Stop, an Approval and the
//! Allowlist must behave the way the log already says they do.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::sync::watch;
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRegistry, ToolRunner};
use veeloe_runtime_core::{
    conversation, AgentCore, ApprovalDecision, EventStore, FromWorker, Llm, LlmError, LlmReply,
    LlmRequest, SupervisorLink, TaskEvent, ToWorker, TriggerRun,
};

#[derive(Default)]
struct RecordingLink {
    sent: Mutex<Vec<FromWorker>>,
}

impl SupervisorLink for RecordingLink {
    fn send(&self, message: FromWorker) {
        self.sent.lock().expect("sent").push(message);
    }
}

impl RecordingLink {
    fn take(&self) -> Vec<FromWorker> {
        self.sent.lock().expect("sent").clone()
    }

    fn last(&self) -> Option<FromWorker> {
        self.sent.lock().expect("sent").last().cloned()
    }
}

#[derive(Default)]
struct FakeLlm {
    replies: Mutex<VecDeque<Result<LlmReply, LlmError>>>,
    requests: Mutex<Vec<LlmRequest>>,
    gate: Mutex<Option<watch::Receiver<bool>>>,
    /// Naming a Task is its own request beside the Turn's: it is answered from
    /// here and kept out of `replies` and `requests`, so a test about a Turn
    /// sees only that Turn. `None` fails it, which leaves the log as it was.
    title: Mutex<Option<Result<LlmReply, LlmError>>>,
    titles: Mutex<Vec<LlmRequest>>,
}

fn is_title(request: &LlmRequest) -> bool {
    request.system.starts_with("You name a conversation")
}

impl FakeLlm {
    fn with(replies: Vec<Result<LlmReply, LlmError>>) -> Self {
        Self {
            replies: Mutex::new(replies.into()),
            ..Self::default()
        }
    }

    fn requests(&self) -> Vec<LlmRequest> {
        self.requests.lock().expect("requests").clone()
    }
}

#[async_trait]
impl Llm for FakeLlm {
    async fn send(&self, request: LlmRequest, _cancel: &Cancel) -> Result<LlmReply, LlmError> {
        if is_title(&request) {
            self.titles.lock().expect("titles").push(request);
            return self
                .title
                .lock()
                .expect("title")
                .clone()
                .unwrap_or_else(|| Err(LlmError::Failed("unnamed".into())));
        }
        self.requests.lock().expect("requests").push(request);
        let gate = self.gate.lock().expect("gate").clone();
        if let Some(mut gate) = gate {
            // The gate stays open once opened, so every round of a Turn passes.
            while !*gate.borrow() {
                if gate.changed().await.is_err() {
                    break;
                }
            }
        }
        self.replies
            .lock()
            .expect("replies")
            .pop_front()
            .unwrap_or_else(|| Ok(text("ok")))
    }
}

struct Echo;

#[async_trait]
impl ToolRunner for Echo {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![definition("echo")]
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        if name != "echo" {
            return Err(ToolError::Unknown(name.into()));
        }
        Ok(input.to_string())
    }
}

struct Bash {
    ran: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl ToolRunner for Bash {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![definition("bash")]
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        if name != "bash" {
            return Err(ToolError::Unknown(name.into()));
        }
        self.ran.lock().expect("ran").push(
            input
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        );
        Ok("ran".into())
    }
}

/// A bash tool that never finishes on its own, until the Turn's brake stops it.
struct Hanging;

#[async_trait]
impl ToolRunner for Hanging {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![definition("bash")]
    }

    async fn run(&self, _name: &str, _input: &Value, cancel: &Cancel) -> Result<String, ToolError> {
        cancel.cancelled().await;
        Err(ToolError::Stopped)
    }
}

struct Connector {
    ran: Arc<Mutex<Vec<String>>>,
    names: Vec<&'static str>,
}

#[async_trait]
impl ToolRunner for Connector {
    fn definitions(&self) -> Vec<ToolDefinition> {
        self.names.iter().map(|name| definition(name)).collect()
    }

    async fn run(&self, name: &str, _input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        self.ran.lock().expect("ran").push(name.to_string());
        Ok("opened".into())
    }
}

fn definition(name: &str) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: name.into(),
        input_schema: json!({ "type": "object" }),
    }
}

fn text(body: &str) -> LlmReply {
    LlmReply {
        content: vec![json!({ "type": "text", "text": body })],
        stop_reason: Some("end_turn".into()),
    }
}

fn tool_use(id: &str, name: &str, input: Value) -> LlmReply {
    LlmReply {
        content: vec![json!({ "type": "tool_use", "id": id, "name": name, "input": input })],
        stop_reason: Some("tool_use".into()),
    }
}

struct Harness {
    core: AgentCore,
    link: Arc<RecordingLink>,
    llm: Arc<FakeLlm>,
    gate: watch::Sender<bool>,
}

struct Setup {
    replies: Vec<Result<LlmReply, LlmError>>,
    runners: Vec<Arc<dyn ToolRunner>>,
    allowlist: Vec<String>,
    timeout_ms: Option<u64>,
    gated: bool,
    context_window: Option<usize>,
    workdir: Option<PathBuf>,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            replies: Vec::new(),
            runners: Vec::new(),
            allowlist: Vec::new(),
            timeout_ms: None,
            gated: false,
            context_window: None,
            workdir: None,
        }
    }
}

fn setup(setup: Setup) -> Harness {
    let dir = tempdir().expect("tempdir");
    let store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    let mut tools = ToolRegistry::default();
    for runner in setup.runners {
        tools.register(runner).expect("tool");
    }
    let link = Arc::new(RecordingLink::default());
    let (gate, gate_rx) = watch::channel(false);
    let llm = Arc::new(FakeLlm::with(setup.replies));
    if setup.gated {
        *llm.gate.lock().expect("gate") = Some(gate_rx);
    }
    let core = AgentCore::new(
        "Deployer",
        store,
        Arc::clone(&llm) as Arc<dyn Llm>,
        tools,
        Arc::clone(&link) as Arc<dyn SupervisorLink>,
    );
    if let Some(ms) = setup.timeout_ms {
        core.set_approval_timeout_ms(ms);
    }
    if !setup.allowlist.is_empty() {
        core.set_allowlist(setup.allowlist.clone());
    }
    let core = match setup.workdir {
        Some(dir) => core.with_workdir(dir),
        None => core,
    };
    let core = match setup.context_window {
        Some(tokens) => core.with_context_window(tokens),
        None => core,
    };
    Harness {
        core,
        link,
        llm,
        gate,
    }
}

fn message(text: &str) -> ToWorker {
    message_in("t1", text, "m_owner")
}

fn message_in(task: &str, text: &str, member: &str) -> ToWorker {
    ToWorker::Message {
        task: task.into(),
        id: format!("m-{text}"),
        member: member.into(),
        text: text.into(),
        reference: format!("sig-{text}"),
    }
}

fn approval(request: &str, decision: ApprovalDecision) -> ToWorker {
    ToWorker::Approval {
        request: request.into(),
        decision,
        message: None,
        member: "m_owner".into(),
        reference: format!("sig-{request}"),
        task: None,
    }
}

fn stop(id: &str) -> ToWorker {
    stop_in("t1", id)
}

fn stop_in(task: &str, id: &str) -> ToWorker {
    ToWorker::Stop {
        task: task.into(),
        id: id.into(),
        member: "m_owner".into(),
        reference: format!("sig-{id}"),
    }
}

fn kinds(events: &[TaskEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| event.kind != "context.usage" && event.kind != "task.titled")
        .map(|event| event.kind.clone())
        .collect()
}

fn requested_of(harness: &Harness) -> Option<String> {
    harness
        .link
        .take()
        .into_iter()
        .find_map(|message| match message {
            FromWorker::Event { event, .. } if event.kind == "approval.requested" => event
                .body
                .get("request")
                .and_then(Value::as_str)
                .map(str::to_string),
            _ => None,
        })
}

async fn wait_for_requested(harness: &Harness) -> String {
    for _ in 0..400 {
        if let Some(request) = requested_of(harness) {
            return request;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("no Approval was requested");
}

async fn wait_for_kind(harness: &Harness, task: &str, kind: &str) {
    for _ in 0..400 {
        if harness
            .core
            .events(task)
            .expect("events")
            .iter()
            .any(|event| event.kind == kind)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("{kind} never appeared");
}

#[tokio::test]
async fn a_message_starts_a_task_and_a_turn_and_every_event_reaches_the_member_who_started_it() {
    let harness = setup(Setup {
        replies: vec![Ok(text("hi"))],
        ..Setup::default()
    });
    harness.core.receive(message("hello")).expect("receive");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        kinds(&events),
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "turn.ended"
        ]
    );
    let seqs: Vec<i64> = events
        .iter()
        .filter(|event| event.kind != "context.usage" && event.kind != "task.titled")
        .map(|event| event.seq)
        .collect();
    assert_eq!(seqs, vec![1, 2, 4, 5]);
    // Every Turn records the file level it ran at (ADR 0087).
    let started = events
        .iter()
        .find(|event| event.kind == "turn.started")
        .expect("started");
    assert_eq!(started.body["files"], "folder");
    // Every event goes to the starter; the Turn's proxy token is for the supervisor alone.
    assert!(harness.link.take().iter().all(|message| matches!(
        message,
        FromWorker::Event { starter, .. } if starter == "m_owner"
    ) || matches!(
        message,
        FromWorker::TurnProxy { .. }
    )));
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "done" })
    );
}

fn titles(events: &[TaskEvent]) -> Vec<Value> {
    events
        .iter()
        .filter(|event| event.kind == "task.titled")
        .map(|event| event.body.clone())
        .collect()
}

#[tokio::test]
async fn the_first_turn_that_ends_done_names_the_task_from_its_first_message_and_answer() {
    let harness = setup(Setup {
        replies: vec![Ok(text("CI แดงเพราะ lint"))],
        ..Setup::default()
    });
    *harness.llm.title.lock().expect("title") = Some(Ok(text("\"ดูว่าทำไม CI แดง\"\nเพราะ...")));
    harness
        .core
        .receive(message("ช่วยดูว่าทำไม build บน CI แดง"))
        .expect("receive");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(events.last().expect("last").kind, "task.titled");
    assert_eq!(titles(&events), vec![json!({ "title": "ดูว่าทำไม CI แดง" })]);
    let asked = harness.llm.titles.lock().expect("titles").clone();
    assert_eq!(asked.len(), 1);
    assert!(asked[0].tools.is_empty());
    assert_eq!(asked[0].task, "t1");
    let text = asked[0].messages[0].content[0]["text"]
        .as_str()
        .expect("text");
    assert!(text.contains("ช่วยดูว่าทำไม build บน CI แดง") && text.contains("CI แดงเพราะ lint"));
}

#[tokio::test]
async fn a_name_that_fails_leaves_the_turn_done_and_is_not_asked_again() {
    let harness = setup(Setup::default());
    *harness.llm.title.lock().expect("title") =
        Some(Err(LlmError::Failed("provider.unreachable".into())));
    harness.core.receive(message("one")).expect("receive");
    harness.core.idle().await;
    *harness.llm.title.lock().expect("title") = Some(Ok(text("Too late")));
    harness.core.receive(message("two")).expect("receive");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert!(titles(&events).is_empty());
    let ends: Vec<&Value> = events
        .iter()
        .filter(|e| e.kind == "turn.ended")
        .map(|e| &e.body)
        .collect();
    assert_eq!(
        ends,
        vec![&json!({ "reason": "done" }), &json!({ "reason": "done" })]
    );
    assert_eq!(harness.llm.titles.lock().expect("titles").len(), 1);
}

#[tokio::test]
async fn a_named_task_is_not_named_again_and_a_failed_first_turn_waits_for_a_done_one() {
    let harness = setup(Setup {
        replies: vec![Err(LlmError::Failed("provider.unreachable".into()))],
        ..Setup::default()
    });
    *harness.llm.title.lock().expect("title") = Some(Ok(text("Fixing CI")));
    harness.core.receive(message("one")).expect("receive");
    harness.core.idle().await;
    assert!(titles(&harness.core.events("t1").expect("events")).is_empty());

    harness.core.receive(message("two")).expect("receive");
    harness.core.idle().await;
    harness.core.receive(message("three")).expect("receive");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(titles(&events), vec![json!({ "title": "Fixing CI" })]);
    assert_eq!(harness.llm.titles.lock().expect("titles").len(), 1);
}

#[tokio::test]
async fn a_rate_limited_turn_ends_saying_when_to_try_again() {
    let harness = setup(Setup {
        replies: vec![Err(LlmError::RateLimited(Some(30)))],
        ..Setup::default()
    });
    harness.core.receive(message("one")).expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t1").expect("events");
    let ended = events
        .iter()
        .find(|event| event.kind == "turn.ended")
        .expect("ended");
    assert_eq!(
        ended.body,
        json!({ "reason": "error", "code": "provider.rate_limited", "retryAfter": 30 })
    );
}

fn scheduled(task: &str) -> ToWorker {
    ToWorker::Run {
        task: task.into(),
        member: "m_owner".into(),
        text: "check the CI".into(),
        trigger: TriggerRun {
            kind: "schedule".into(),
            id: "tr_1".into(),
            at: 1_000,
            attended: false,
            allow: Vec::new(),
            limit_s: None,
            goal: false,
        },
    }
}

/// A round of `tr_1`, with who is there and what its Schedule may do.
fn round(attended: bool, allow: &[&str]) -> ToWorker {
    let ToWorker::Run {
        task,
        member,
        text,
        mut trigger,
    } = scheduled("t9")
    else {
        unreachable!()
    };
    trigger.attended = attended;
    trigger.allow = allow.iter().map(|entry| entry.to_string()).collect();
    ToWorker::Run {
        task,
        member,
        text,
        trigger,
    }
}

#[tokio::test]
async fn a_round_nobody_watches_asks_no_one_and_does_only_its_scope() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "u1",
                "bash",
                json!({ "command": "curl -s example.com" }),
            )),
            Ok(tool_use("u2", "bash", json!({ "command": "rm -rf build" }))),
            Ok(tool_use("u3", "nothing_to_report", json!({}))),
            Ok(text("I could not clean build/")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        ..Setup::default()
    });
    harness
        .core
        .receive(round(false, &["curl"]))
        .expect("receive");
    harness.core.idle().await;

    // In scope ran; outside it was refused at once, never asked.
    assert_eq!(*ran.lock().expect("ran"), vec!["curl -s example.com"]);
    let events = harness.core.events("t9").expect("events");
    assert!(!kinds(&events).contains(&"approval.requested".to_string()));
    let skipped = events
        .iter()
        .find(|event| event.kind == "approval.skipped")
        .expect("skipped");
    assert_eq!(skipped.body["command"], "rm -rf build");
    assert_eq!(
        events
            .iter()
            .find(|event| event.kind == "turn.started")
            .expect("started")
            .body["trigger"]["attended"],
        false
    );
    // What did not run cannot end quietly: the owner hears of it.
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_round_someone_ran_asks_as_any_turn_does() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("u1", "bash", json!({ "command": "rm -rf build" }))),
            Ok(text("ok")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::new(Mutex::new(Vec::new())),
        })],
        timeout_ms: Some(50),
        ..Setup::default()
    });
    harness.core.receive(round(true, &[])).expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t9").expect("events");
    assert!(kinds(&events).contains(&"approval.requested".to_string()));
    assert!(!kinds(&events).contains(&"approval.skipped".to_string()));
}

fn tool_names(request: &LlmRequest) -> Vec<String> {
    request.tools.iter().map(|tool| tool.name.clone()).collect()
}

#[tokio::test]
async fn a_trigger_round_says_where_it_came_from_and_who_set_it() {
    let harness = setup(Setup {
        replies: vec![Ok(text("CI is green"))],
        ..Setup::default()
    });
    harness.core.receive(scheduled("t9")).expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t9").expect("events");
    let started = events
        .iter()
        .find(|event| event.kind == "turn.started")
        .expect("started");
    assert_eq!(
        started.body,
        json!({ "member": "m_owner", "files": "folder", "trigger": { "kind": "schedule", "id": "tr_1", "at": 1_000, "attended": false } })
    );
    let said = events
        .iter()
        .find(|event| event.kind == "member.message")
        .expect("message");
    assert_eq!(said.body["text"], "check the CI");
    assert_eq!(said.body["trigger"]["id"], "tr_1");
    // Ended with words: an ordinary Task, which the Inbox shows.
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "done" })
    );
    assert!(tool_names(&harness.llm.requests()[0]).contains(&"nothing_to_report".to_string()));
}

#[tokio::test]
async fn nothing_to_report_ends_the_round_quietly_and_only_a_trigger_has_it() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("u1", "nothing_to_report", json!({}))),
            Ok(text("hello")),
        ],
        ..Setup::default()
    });
    harness.core.receive(scheduled("t9")).expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t9").expect("events");
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "quiet" })
    );

    harness.core.receive(message("hi")).expect("receive");
    harness.core.idle().await;
    let requests = harness.llm.requests();
    assert!(
        !tool_names(requests.last().expect("request")).contains(&"nothing_to_report".to_string())
    );
}

fn retitle(title: &str, member: &str) -> ToWorker {
    ToWorker::Retitle {
        task: "t1".into(),
        title: title.into(),
        member: member.into(),
        reference: format!("sig-{title}"),
    }
}

#[tokio::test]
async fn the_member_who_started_a_task_names_it_and_no_one_else_can() {
    let harness = setup(Setup::default());
    harness.core.receive(message("hello")).expect("receive");
    harness.core.idle().await;
    harness.link.take();

    harness
        .core
        .receive(retitle("  ทบทวน git  ", "m_owner"))
        .expect("retitle");
    harness
        .core
        .receive(retitle("Mine now", "m_other"))
        .expect("retitle");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        titles(&events),
        vec![json!({ "title": "ทบทวน git", "member": "m_owner" })]
    );
    let codes: Vec<String> = harness
        .link
        .take()
        .into_iter()
        .filter_map(|message| match message {
            FromWorker::Error { code, .. } => Some(code),
            _ => None,
        })
        .collect();
    assert_eq!(codes, vec!["task.not_found"]);
}

#[tokio::test]
async fn a_task_the_member_named_before_its_first_turn_ended_keeps_their_name() {
    let harness = setup(Setup::default());
    *harness.llm.title.lock().expect("title") = Some(Ok(text("Fixing CI")));
    harness.core.receive(message("hello")).expect("receive");
    harness
        .core
        .receive(retitle("My name", "m_owner"))
        .expect("retitle");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        titles(&events),
        vec![json!({ "title": "My name", "member": "m_owner" })]
    );
    assert!(harness.llm.titles.lock().expect("titles").is_empty());
}

#[tokio::test]
async fn a_second_message_goes_on_from_the_whole_conversation() {
    let harness = setup(Setup {
        replies: vec![Ok(text("first answer")), Ok(text("second answer"))],
        ..Setup::default()
    });
    harness.core.receive(message("one")).expect("receive");
    harness.core.idle().await;
    harness.core.receive(message("two")).expect("receive");
    harness.core.idle().await;

    let requests = harness.llm.requests();
    let messages = &requests[1].messages;
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].content[0]["text"], "one");
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(messages[1].content[0]["text"], "first answer");
    assert_eq!(messages[2].role, "user");
    assert_eq!(messages[2].content[0]["text"], "two");
}

#[tokio::test]
async fn a_message_sent_again_is_not_written_twice_and_starts_no_turn() {
    let harness = setup(Setup::default());
    harness.core.receive(message("hello")).expect("receive");
    harness.core.idle().await;
    harness.core.receive(message("hello")).expect("resend");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "member.message")
            .count(),
        1
    );
    assert_eq!(harness.llm.requests().len(), 1);
}

#[tokio::test]
async fn a_message_during_a_turn_waits_and_then_becomes_the_next_turn() {
    let harness = setup(Setup {
        gated: true,
        ..Setup::default()
    });
    harness.core.receive(message("first")).expect("first");
    harness.core.receive(message("second")).expect("second");
    harness.core.receive(message("third")).expect("third");
    let _ = harness.gate.send(true);
    harness.core.idle().await;
    // The first Turn's end starts the queued one; wait for that one too.
    harness.core.idle().await;
    harness.core.idle().await;
    let events = harness.core.events("t1").expect("events");
    let texts: Vec<&str> = events
        .iter()
        .filter(|event| event.kind == "member.message")
        .filter_map(|event| event.body.get("text").and_then(Value::as_str))
        .collect();
    assert_eq!(texts, vec!["first", "second", "third"]);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "turn.started")
            .count(),
        3
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "turn.ended")
            .count(),
        3
    );
    assert_eq!(harness.llm.requests().len(), 3);
}

#[tokio::test]
async fn every_turn_is_told_where_memory_lives_and_gets_its_text() {
    let dir = tempdir().expect("workdir");
    std::fs::write(dir.path().join("MEMORY.md"), "owner likes tea").expect("memory");
    let harness = setup(Setup {
        replies: vec![Ok(text("done"))],
        workdir: Some(dir.path().to_path_buf()),
        ..Setup::default()
    });
    harness.core.receive(message("hi")).expect("receive");
    harness.core.idle().await;

    let system = &harness.llm.requests()[0].system;
    assert!(system.contains("MEMORY.md at the root"), "{system}");
    assert!(system.contains("owner likes tea"), "{system}");
}

#[tokio::test]
async fn a_turn_without_a_memory_file_still_names_it() {
    let dir = tempdir().expect("workdir");
    let harness = setup(Setup {
        replies: vec![Ok(text("done"))],
        workdir: Some(dir.path().to_path_buf()),
        ..Setup::default()
    });
    harness.core.receive(message("hi")).expect("receive");
    harness.core.idle().await;

    let system = &harness.llm.requests()[0].system;
    assert!(system.contains("MEMORY.md at the root"), "{system}");
    assert!(!system.contains("MEMORY.md as it is now"), "{system}");
}

#[tokio::test]
async fn before_compaction_the_turn_saves_memory_and_still_summarizes() {
    let dir = tempdir().expect("workdir");
    let harness = setup(Setup {
        replies: vec![
            Ok(text("owner name: Nek")),
            Ok(text("the summary")),
            Ok(text("done")),
        ],
        workdir: Some(dir.path().to_path_buf()),
        context_window: Some(20),
        ..Setup::default()
    });
    // 120 characters is roughly 40 tokens, past 70% of a 20-token window.
    harness
        .core
        .receive(message(&"x".repeat(120)))
        .expect("receive");
    harness.core.idle().await;

    assert_eq!(
        std::fs::read_to_string(dir.path().join("MEMORY.md")).expect("memory"),
        "owner name: Nek"
    );
    // One silent flush, one summary, then the answer.
    assert_eq!(harness.llm.requests().len(), 3);
    let kinds: Vec<String> = harness
        .link
        .take()
        .into_iter()
        .filter_map(|message| match message {
            FromWorker::Event { event, .. } => Some(event.kind),
            _ => None,
        })
        .collect();
    let saved = kinds
        .iter()
        .position(|kind| kind == "memory.saved")
        .expect("saved");
    let compacted = kinds
        .iter()
        .position(|kind| kind == "context.compacted")
        .expect("compacted");
    assert!(saved < compacted, "{kinds:?}");
}

#[tokio::test]
async fn a_flush_that_writes_an_essay_is_cut_to_its_budget() {
    let dir = tempdir().expect("workdir");
    let harness = setup(Setup {
        replies: vec![
            Ok(text(&"a".repeat(5_000))),
            Ok(text("the summary")),
            Ok(text("done")),
        ],
        workdir: Some(dir.path().to_path_buf()),
        context_window: Some(20),
        ..Setup::default()
    });
    harness
        .core
        .receive(message(&"x".repeat(120)))
        .expect("receive");
    harness.core.idle().await;

    let memory = std::fs::read_to_string(dir.path().join("MEMORY.md")).expect("memory");
    assert_eq!(memory.chars().count(), 400);
}

#[tokio::test]
async fn a_flush_that_says_nothing_is_not_a_reason_to_skip_compaction() {
    let dir = tempdir().expect("workdir");
    let harness = setup(Setup {
        replies: vec![
            Ok(text("NO_REPLY")),
            Ok(text("the summary")),
            Ok(text("done")),
        ],
        workdir: Some(dir.path().to_path_buf()),
        context_window: Some(20),
        ..Setup::default()
    });
    harness
        .core
        .receive(message(&"x".repeat(120)))
        .expect("receive");
    harness.core.idle().await;

    assert!(!dir.path().join("MEMORY.md").exists());
    assert_eq!(harness.llm.requests().len(), 3);
}

#[tokio::test]
async fn a_failed_flush_does_not_fail_the_turn() {
    let dir = tempdir().expect("workdir");
    let harness = setup(Setup {
        replies: vec![
            Err(LlmError::Failed("provider.unreachable".into())),
            Ok(text("the summary")),
            Ok(text("done")),
        ],
        workdir: Some(dir.path().to_path_buf()),
        context_window: Some(20),
        ..Setup::default()
    });
    harness
        .core
        .receive(message(&"x".repeat(120)))
        .expect("receive");
    harness.core.idle().await;

    assert!(!dir.path().join("MEMORY.md").exists());
    assert_eq!(harness.llm.requests().len(), 3);
}

#[tokio::test]
async fn a_new_name_reaches_the_next_turn_and_the_turn_running_keeps_the_old_one() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("u1", "echo", json!({}))),
            Ok(text("done")),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Echo)],
        allowlist: vec!["echo".into()],
        gated: true,
        ..Setup::default()
    });
    harness.core.receive(message("first")).expect("receive");
    harness.core.rename("Builder");
    let _ = harness.gate.send(true);
    harness.core.idle().await;
    harness
        .core
        .receive(message_in("t2", "second", "m_owner"))
        .expect("second");
    harness.core.idle().await;

    let systems: Vec<String> = harness
        .llm
        .requests()
        .iter()
        .map(|request| {
            request
                .system
                .split(',')
                .next()
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    assert_eq!(
        systems,
        vec!["You are Deployer", "You are Deployer", "You are Builder"]
    );
}

#[tokio::test]
async fn a_tool_the_llm_asks_for_runs_and_its_result_goes_into_the_next_request() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("tu1", "echo", json!({ "a": 1 }))),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Echo)],
        allowlist: vec!["echo".into()],
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(
        kinds(&harness.core.events("t1").expect("events")),
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "tool.result",
            "llm.message",
            "turn.ended",
        ]
    );
    let requests = harness.llm.requests();
    assert_eq!(requests[1].messages.last().expect("last").role, "user");
    assert_eq!(
        requests[1].messages.last().expect("last").content[0],
        json!({ "type": "tool_result", "tool_use_id": "tu1", "content": "{\"a\":1}" })
    );
}

#[tokio::test]
async fn a_tool_the_agent_does_not_have_comes_back_as_an_error_result_and_the_turn_goes_on() {
    let harness = setup(Setup {
        replies: vec![Ok(tool_use("tu1", "bash", json!({}))), Ok(text("sorry"))],
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    let requests = harness.llm.requests();
    assert_eq!(
        requests[1].messages.last().expect("last").content[0],
        json!({
            "type": "tool_result",
            "tool_use_id": "tu1",
            "content": "there is no tool named bash",
            "is_error": true,
        })
    );
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_turn_that_keeps_asking_for_tools_stops_at_the_ceiling() {
    let rounds = 5;
    let harness = setup(Setup {
        replies: (0..rounds + 2)
            .map(|_| Ok(tool_use("tu", "echo", json!({}))))
            .collect(),
        runners: vec![Arc::new(Echo)],
        allowlist: vec!["echo".into()],
        ..Setup::default()
    });
    let core = harness.core.with_max_rounds(rounds);
    core.receive(message("loop")).expect("receive");
    core.idle().await;

    assert_eq!(harness.llm.requests().len(), rounds);
    assert_eq!(
        core.events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "error", "code": "turn.too_many_rounds" })
    );
}

#[tokio::test]
async fn a_provider_that_fails_ends_the_turn_with_its_code_and_the_task_can_go_on() {
    let harness = setup(Setup {
        replies: vec![
            Err(LlmError::Failed("provider.unreachable".into())),
            Ok(text("back")),
        ],
        ..Setup::default()
    });
    harness.core.receive(message("one")).expect("receive");
    harness.core.idle().await;
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "error", "code": "provider.unreachable" })
    );
    harness.core.receive(message("two")).expect("receive");
    harness.core.idle().await;
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn another_member_cannot_write_in_or_read_a_task_someone_else_started() {
    let harness = setup(Setup::default());
    harness.core.receive(message("mine")).expect("receive");
    harness.core.idle().await;
    harness
        .core
        .receive(message_in("t1", "theirs", "m_other"))
        .expect("theirs");
    harness
        .core
        .receive(ToWorker::Sync {
            task: "t1".into(),
            after: 0,
            member: "m_other".into(),
            reference: "sig-sync".into(),
        })
        .expect("sync");

    let codes: Vec<String> = harness
        .link
        .take()
        .into_iter()
        .rev()
        .take(2)
        .filter_map(|message| match message {
            FromWorker::Error { code, .. } => Some(code),
            _ => None,
        })
        .collect();
    assert_eq!(codes, vec!["task.not_found", "task.not_found"]);
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .iter()
            .filter(|event| event.kind == "member.message")
            .count(),
        1
    );
}

#[tokio::test]
async fn sync_answers_the_events_after_a_number_for_the_member_who_started_the_task() {
    let harness = setup(Setup::default());
    harness.core.receive(message("hello")).expect("receive");
    harness.core.idle().await;
    harness
        .core
        .receive(ToWorker::Sync {
            task: "t1".into(),
            after: 2,
            member: "m_owner".into(),
            reference: "sig-sync".into(),
        })
        .expect("sync");

    match harness.link.last() {
        Some(FromWorker::Events { events, .. }) => {
            let seqs: Vec<i64> = events.iter().map(|event| event.seq).collect();
            assert_eq!(seqs, vec![3, 4, 5]);
        }
        other => panic!("expected events, got {other:?}"),
    }
}

#[tokio::test]
async fn a_turn_its_worker_never_finished_keeps_the_members_words_and_drops_its_tool_use() {
    let events = vec![
        TaskEvent {
            seq: 1,
            kind: "member.message".into(),
            at: 1,
            body: json!({ "text": "one" }),
        },
        TaskEvent {
            seq: 2,
            kind: "turn.started".into(),
            at: 2,
            body: json!({}),
        },
        TaskEvent {
            seq: 3,
            kind: "llm.message".into(),
            at: 3,
            body: json!({ "content": [{ "type": "tool_use", "id": "x", "name": "echo", "input": {} }] }),
        },
        TaskEvent {
            seq: 4,
            kind: "member.message".into(),
            at: 4,
            body: json!({ "text": "two" }),
        },
        TaskEvent {
            seq: 5,
            kind: "turn.started".into(),
            at: 5,
            body: json!({}),
        },
    ];
    let messages = conversation(&events);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].content[0]["text"], "one");
    assert_eq!(messages[1].content[0]["text"], "two");
}

fn bash_harness(
    replies: Vec<Result<LlmReply, LlmError>>,
    allowlist: Vec<String>,
) -> (Harness, Arc<Mutex<Vec<String>>>) {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies,
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        allowlist,
        ..Setup::default()
    });
    (harness, ran)
}

#[tokio::test]
async fn a_bash_command_in_the_allowlist_runs_without_asking() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-make",
                "bash",
                json!({ "command": "make test" }),
            )),
            Ok(text("done")),
        ],
        vec!["make".into()],
    );
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(*ran.lock().expect("ran"), vec!["make test"]);
    assert!(!kinds(&harness.core.events("t1").expect("events"))
        .contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn an_approved_command_runs_and_the_log_holds_the_approval_pair() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("done")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    assert!(ran.lock().expect("ran").is_empty());
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Approve))
        .expect("approve");
    harness.core.idle().await;

    assert_eq!(*ran.lock().expect("ran"), vec!["rm -rf dist"]);
    assert_eq!(
        kinds(&harness.core.events("t1").expect("events")),
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "approval.requested",
            "approval.answered",
            "tool.result",
            "llm.message",
            "turn.ended",
        ]
    );
    let answered = harness
        .core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "approval.answered")
        .expect("answered");
    assert_eq!(answered.body["request"], json!(request));
    assert_eq!(answered.body["member"], json!("m_owner"));
    assert_eq!(answered.body["decision"], json!("approve"));
    let requests = harness.llm.requests();
    assert_eq!(
        requests[1].messages.last().expect("last").content[0],
        json!({ "type": "tool_result", "tool_use_id": "tu-rm", "content": "ran" })
    );
}

#[tokio::test]
async fn a_denied_command_comes_back_as_an_error_result_and_the_turn_goes_on() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("sorry")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Deny))
        .expect("deny");
    harness.core.idle().await;

    assert!(ran.lock().expect("ran").is_empty());
    let requests = harness.llm.requests();
    let result = &requests[1].messages.last().expect("last").content[0];
    assert_eq!(result["is_error"], json!(true));
    assert!(result["content"]
        .as_str()
        .expect("content")
        .contains("denied"));
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_redirect_tells_the_llm_what_to_do_instead() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    harness
        .core
        .receive(ToWorker::Approval {
            request: request.clone(),
            decision: ApprovalDecision::Redirect,
            message: Some("use ls instead".into()),
            member: "m_owner".into(),
            reference: format!("sig-{request}"),
            task: None,
        })
        .expect("redirect");
    harness.core.idle().await;

    assert!(ran.lock().expect("ran").is_empty());
    let requests = harness.llm.requests();
    let content = requests[1].messages.last().expect("last").content[0]["content"]
        .as_str()
        .expect("content")
        .to_string();
    assert!(content.contains("use ls instead"));
}

#[tokio::test]
async fn an_approval_no_one_answers_expires_and_the_command_does_not_run() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        timeout_ms: Some(20),
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert!(ran.lock().expect("ran").is_empty());
    let requests = harness.llm.requests();
    let content = requests[1].messages.last().expect("last").content[0]["content"]
        .as_str()
        .expect("content")
        .to_string();
    assert!(content.contains("expired"));
    let answered = harness
        .core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "approval.answered")
        .expect("answered");
    assert_eq!(answered.body["decision"], json!("deny"));
    assert_eq!(answered.body["message"], json!("expired without an answer"));
}

/// ADR 0022: the core reads "now" from its Clock, so an Approval's expiry is
/// stamped from the clock it was given, not the Machine's.
#[tokio::test]
async fn an_approval_expiry_comes_from_the_cores_clock() {
    struct Fixed;
    impl veeloe_runtime_core::event_store::Clock for Fixed {
        fn now(&self) -> i64 {
            1_000_000
        }
    }
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::new(Mutex::new(Vec::new())),
        })],
        timeout_ms: Some(20),
        ..Setup::default()
    });
    let core = harness.core.with_clock(Arc::new(Fixed));
    core.receive(message("go")).expect("receive");
    core.idle().await;

    let requested = core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "approval.requested")
        .expect("requested");
    assert_eq!(requested.body["expiresAt"], json!(1_000_020));
}

#[tokio::test]
async fn an_answer_to_no_waiting_approval_is_approval_unknown() {
    let harness = setup(Setup::default());
    harness
        .core
        .receive(approval("ap_nope", ApprovalDecision::Approve))
        .expect("approve");
    assert_eq!(
        harness.link.take(),
        vec![FromWorker::Error {
            member: "m_owner".into(),
            reference: "sig-ap_nope".into(),
            code: "approval.unknown".into(),
            task: None,
        }]
    );
}

#[tokio::test]
async fn a_command_that_only_reads_runs_with_an_empty_allowlist() {
    // ADR 0075: printing and reading need no entry, and a redirect into /dev/null writes nothing.
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-read",
                "bash",
                json!({ "command": "ls -la; cat MEMORY.md 2>/dev/null" }),
            )),
            Ok(text("done")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(
        *ran.lock().expect("ran"),
        vec!["ls -la; cat MEMORY.md 2>/dev/null"]
    );
    assert!(!kinds(&harness.core.events("t1").expect("events"))
        .contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn a_new_allowlist_reaches_the_next_tool_call() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("tu-make", "bash", json!({ "command": "make" }))),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        ..Setup::default()
    });
    harness.core.set_allowlist(vec!["make".into()]);
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(*ran.lock().expect("ran"), vec!["make"]);
    assert!(!kinds(&harness.core.events("t1").expect("events"))
        .contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn a_connector_tool_outside_the_allowlist_waits_too_and_an_exact_name_runs_it() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("tu-pr", "github/create_pull_request", json!({}))),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Connector {
            ran: Arc::clone(&ran),
            names: vec!["github/create_pull_request"],
        })],
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    let asked = harness
        .core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "approval.requested")
        .expect("requested");
    assert_eq!(asked.body["parts"], json!(["github/create_pull_request"]));
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Approve))
        .expect("approve");
    harness.core.idle().await;

    assert_eq!(
        *ran.lock().expect("ran"),
        vec!["github/create_pull_request".to_string()]
    );
    let requests = harness.llm.requests();
    assert_eq!(
        requests[1].messages.last().expect("last").content[0],
        json!({ "type": "tool_result", "tool_use_id": "tu-pr", "content": "opened" })
    );
}

#[tokio::test]
async fn a_connector_tool_named_in_the_allowlist_runs_without_asking_and_file_tools_always_do() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("u1", "github/create_pull_request", json!({}))),
            Ok(tool_use("u2", "read", json!({}))),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Connector {
            ran: Arc::clone(&ran),
            names: vec!["read", "github/create_pull_request"],
        })],
        allowlist: vec!["github/create_pull_request".into()],
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(
        *ran.lock().expect("ran"),
        vec!["github/create_pull_request".to_string(), "read".to_string()]
    );
    assert!(!kinds(&harness.core.events("t1").expect("events"))
        .contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn an_answer_for_another_task_is_approval_unknown() {
    let (harness, _ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    harness
        .core
        .receive(ToWorker::Approval {
            request: request.clone(),
            decision: ApprovalDecision::Approve,
            message: None,
            member: "m_owner".into(),
            reference: "sig-x".into(),
            task: Some("other-task".into()),
        })
        .expect("answer");
    assert_eq!(
        harness.link.last(),
        Some(FromWorker::Error {
            member: "m_owner".into(),
            reference: "sig-x".into(),
            code: "approval.unknown".into(),
            task: None,
        })
    );
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Deny))
        .expect("deny");
    harness.core.idle().await;
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_new_timeout_reaches_the_next_wait_and_a_bad_value_keeps_the_old_one() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        timeout_ms: Some(60_000),
        ..Setup::default()
    });
    harness.core.set_approval_timeout_ms(0); // a bad value keeps the old one
    harness.core.set_approval_timeout_ms(30);
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert!(ran.lock().expect("ran").is_empty());
    let requests = harness.llm.requests();
    let content = requests[1].messages.last().expect("last").content[0]["content"]
        .as_str()
        .expect("content")
        .to_string();
    assert!(content.contains("expired"));
    let answered = harness
        .core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "approval.answered")
        .expect("answered");
    assert_eq!(answered.body["decision"], json!("deny"));
}

#[tokio::test]
async fn a_stop_ends_the_turn_with_who_stopped_it_and_the_task_goes_on_from_the_same_conversation()
{
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-sleep",
                "bash",
                json!({ "command": "sleep 1000" }),
            )),
            Ok(text("back")),
        ],
        runners: vec![Arc::new(Hanging)],
        allowlist: vec!["sleep 1000".into()],
        ..Setup::default()
    });
    harness.core.receive(message("run")).expect("receive");
    wait_for_kind(&harness, "t1", "llm.message").await;
    // The command is running: the Stop cuts it and the Turn ends as stopped,
    // not as an error.
    harness.core.receive(stop("stop-1")).expect("stop");
    harness.core.idle().await;

    assert_eq!(
        kinds(&harness.core.events("t1").expect("events")),
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "turn.stopped",
            "turn.ended",
        ]
    );
    let stopped = harness
        .core
        .events("t1")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "turn.stopped")
        .expect("stopped");
    assert_eq!(stopped.body, json!({ "member": "m_owner" }));
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "stopped" })
    );

    // The same Stop again changes nothing, and the Task talks again with its history.
    harness.core.receive(stop("stop-1")).expect("stop again");
    assert_eq!(
        kinds(&harness.core.events("t1").expect("events"))
            .iter()
            .filter(|kind| *kind == "turn.stopped")
            .count(),
        1
    );
    harness.core.receive(message("continue")).expect("continue");
    harness.core.idle().await;
    let roles: Vec<String> = harness
        .llm
        .requests()
        .last()
        .expect("last request")
        .messages
        .iter()
        .map(|message| message.role.clone())
        .collect();
    assert_eq!(roles, vec!["user", "assistant", "user"]);
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_stop_while_waiting_on_the_llm_drops_the_answer_that_arrives_after_it() {
    let harness = setup(Setup {
        replies: vec![Ok(text("late answer"))],
        gated: true,
        ..Setup::default()
    });
    harness.core.receive(message("ask")).expect("receive");
    harness.core.receive(stop("stop-2")).expect("stop");
    let _ = harness.gate.send(true);
    harness.core.idle().await;

    assert_eq!(
        kinds(&harness.core.events("t1").expect("events")),
        vec![
            "member.message",
            "turn.started",
            "turn.stopped",
            "turn.ended"
        ]
    );
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "stopped" })
    );
    // The answer is not written as this Turn's words.
    assert!(!harness.link.take().iter().any(
        |message| matches!(message, FromWorker::Event { event, .. } if event.kind == "llm.message")
    ));
}

#[tokio::test]
async fn a_stop_while_an_approval_waits_ends_the_turn_and_a_late_answer_is_approval_unknown() {
    let (harness, _ran) = bash_harness(
        vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        Vec::new(),
    );
    harness.core.receive(message("go")).expect("receive");
    let request = wait_for_requested(&harness).await;
    harness.core.receive(stop("stop-3")).expect("stop");
    harness.core.idle().await;

    assert!(!harness
        .core
        .events("t1")
        .expect("events")
        .iter()
        .any(|event| event.kind == "approval.answered"));
    assert_eq!(
        harness
            .core
            .events("t1")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "stopped" })
    );
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Approve))
        .expect("late answer");
    assert_eq!(
        harness.link.last(),
        Some(FromWorker::Error {
            member: "m_owner".into(),
            reference: format!("sig-{request}"),
            code: "approval.unknown".into(),
            task: None,
        })
    );
}

#[tokio::test]
async fn a_stop_with_no_turn_running_is_turn_not_running_and_one_for_another_task_is_task_not_found(
) {
    let dir = tempdir().expect("tempdir");
    let store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    // A Task someone else started, with no Turn running in it.
    store.create_task("t-other", "m_other").expect("task");
    let link = Arc::new(RecordingLink::default());
    let llm = Arc::new(FakeLlm::with(vec![
        Ok(tool_use(
            "tu-sleep",
            "bash",
            json!({ "command": "sleep 1000" }),
        )),
        Ok(text("ok")),
    ]));
    let mut tools = ToolRegistry::default();
    tools.register(Arc::new(Hanging)).expect("tool");
    let core = AgentCore::new(
        "Deployer",
        store,
        Arc::clone(&llm) as Arc<dyn Llm>,
        tools,
        Arc::clone(&link) as Arc<dyn SupervisorLink>,
    );
    core.set_allowlist(vec!["sleep 1000".into()]);

    core.receive(stop("stop-4")).expect("stop");
    assert_eq!(
        link.last(),
        Some(FromWorker::Error {
            member: "m_owner".into(),
            reference: "sig-stop-4".into(),
            code: "turn.not_running".into(),
            task: Some("t1".into()),
        })
    );

    core.receive(message("run")).expect("receive");
    for _ in 0..400 {
        if core
            .events("t1")
            .expect("events")
            .iter()
            .any(|event| event.kind == "llm.message")
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    // A Task someone else started is not even said to exist to this Member.
    core.receive(stop_in("t-other", "stop-5"))
        .expect("stop other");
    assert_eq!(
        link.last(),
        Some(FromWorker::Error {
            member: "m_owner".into(),
            reference: "sig-stop-5".into(),
            code: "task.not_found".into(),
            task: Some("t-other".into()),
        })
    );
    core.receive(stop("stop-6")).expect("stop");
    core.idle().await;
}

#[tokio::test]
async fn a_worker_that_starts_again_closes_every_turn_left_open_and_nothing_runs_twice() {
    let dir = tempdir().expect("tempdir");
    let mut store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    // What a worker that died mid-Turn leaves behind: a start with no end.
    store.create_task("t-open", "m_owner").expect("task");
    store
        .append(
            "t-open",
            "member.message",
            &json!({ "member": "m_owner", "id": "m-1", "text": "deploy" }),
            Some("m-1"),
        )
        .expect("message");
    store
        .append(
            "t-open",
            "turn.started",
            &json!({ "member": "m_owner" }),
            None,
        )
        .expect("start");
    store.create_task("t-done", "m_owner").expect("task");
    store
        .append(
            "t-done",
            "turn.started",
            &json!({ "member": "m_owner" }),
            None,
        )
        .expect("start");
    store
        .append("t-done", "turn.ended", &json!({ "reason": "done" }), None)
        .expect("end");

    let link = Arc::new(RecordingLink::default());
    let llm = Arc::new(FakeLlm::with(vec![Ok(text("back"))]));
    let core = AgentCore::new(
        "Deployer",
        store,
        Arc::clone(&llm) as Arc<dyn Llm>,
        ToolRegistry::default(),
        Arc::clone(&link) as Arc<dyn SupervisorLink>,
    );
    core.close_open_turns().expect("close");

    assert_eq!(
        kinds(&core.events("t-open").expect("events")),
        vec![
            "member.message",
            "turn.started",
            "turn.interrupted",
            "turn.ended",
        ]
    );
    let open = core.events("t-open").expect("events");
    assert_eq!(open[open.len() - 2].body, json!({ "reason": "restart" }));
    assert_eq!(
        open[open.len() - 1].body,
        json!({ "reason": "interrupted" })
    );
    // A Task that had ended is left alone.
    assert_eq!(
        kinds(&core.events("t-done").expect("events")),
        vec!["turn.started", "turn.ended"]
    );

    // The Agent is free again: the same Task takes a new message.
    core.receive(message_in("t-open", "continue", "m_owner"))
        .expect("continue");
    core.idle().await;
    assert_eq!(
        core.events("t-open")
            .expect("events")
            .last()
            .expect("last")
            .body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_second_stop_for_the_same_turn_writes_no_second_turn_stopped_and_the_turn_ends_once() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-sleep",
                "bash",
                json!({ "command": "sleep 1000" }),
            )),
            Ok(text("back")),
        ],
        runners: vec![Arc::new(Hanging)],
        allowlist: vec!["sleep 1000".into()],
        ..Setup::default()
    });
    harness.core.receive(message("run")).expect("receive");
    wait_for_kind(&harness, "t1", "llm.message").await;
    // Two different Stop commands arrive before the Turn has settled: one
    // brake, one record.
    harness.core.receive(stop("stop-a")).expect("stop a");
    harness.core.receive(stop("stop-b")).expect("stop b");
    harness.core.idle().await;

    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "turn.stopped")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "turn.ended")
            .count(),
        1
    );
}

#[tokio::test]
async fn a_long_turn_is_summarized_and_the_next_request_sees_the_summary() {
    let harness = setup(Setup {
        replies: vec![
            Ok(text("The earlier work was about a release.")),
            Ok(text("done")),
        ],
        context_window: Some(100),
        ..Setup::default()
    });
    harness
        .core
        .receive(message(&"x".repeat(500)))
        .expect("receive");
    harness.core.idle().await;

    let requests = harness.llm.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].system.contains("compact"));
    let second = &requests[1].messages[0];
    assert!(second.content.iter().any(|block| block["text"]
        .as_str()
        .is_some_and(|text| text.contains("The earlier work"))));
    let events = harness.core.events("t1").expect("events");
    assert!(events.iter().any(|event| event.kind == "context.compacted"));
}

/// A bash tool that writes three lines of output as it runs (ADR 0073).
struct Chatty;

#[async_trait]
impl ToolRunner for Chatty {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![definition("bash")]
    }

    async fn run(
        &self,
        _name: &str,
        _input: &Value,
        _cancel: &Cancel,
    ) -> Result<String, ToolError> {
        let sink = veeloe_plugin_api::progress().expect("the worker watches bash output");
        for line in ["line 1\n", "line 2\n", "line 3\n"] {
            sink(line.as_bytes());
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Ok("line 1\nline 2\nline 3\nexit code: 0".into())
    }
}

fn outputs(harness: &Harness) -> Vec<(String, String, u64)> {
    harness
        .link
        .take()
        .into_iter()
        .filter_map(|message| match message {
            FromWorker::ToolOutput {
                tool_use_id,
                tail,
                bytes,
                ..
            } => Some((tool_use_id, tail, bytes)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_running_command_sends_its_output_live_at_most_once_a_second_and_none_of_it_is_logged() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-test",
                "bash",
                json!({ "command": "cargo test" }),
            )),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Chatty)],
        allowlist: vec!["cargo test".into()],
        ..Setup::default()
    });
    harness.core.receive(message("test")).expect("receive");
    harness.core.idle().await;

    // Three chunks inside one second: only the first goes out, and the result still has them all.
    assert_eq!(
        outputs(&harness),
        vec![("tu-test".to_string(), "line 1\n".to_string(), 7)]
    );
    let events = harness.core.events("t1").expect("events");
    assert!(events.iter().all(|event| event.kind != "tool.output"));
    let result = events
        .iter()
        .find(|event| event.kind == "tool.result")
        .expect("result");
    assert!(result.body.to_string().contains("line 3"));
}

#[tokio::test]
async fn a_turn_quiet_past_the_stall_time_is_written_down_once() {
    let mut harness = setup(Setup {
        replies: vec![Ok(tool_use(
            "tu-sleep",
            "bash",
            json!({ "command": "sleep 1000" }),
        ))],
        runners: vec![Arc::new(Hanging)],
        allowlist: vec!["sleep 1000".into()],
        ..Setup::default()
    });
    harness.core = harness.core.with_stall_after(Duration::from_millis(40));
    harness.core.receive(message("run")).expect("receive");
    wait_for_kind(&harness, "t1", "turn.stalled").await;
    // Still quiet: no second stall for the same stretch.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let events = harness.core.events("t1").expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "turn.stalled")
            .count(),
        1
    );
    assert!(events
        .iter()
        .any(|event| event.kind == "turn.stalled" && event.body.get("since").is_some()));
    harness.core.receive(stop("stop-1")).expect("stop");
    harness.core.idle().await;
}

#[tokio::test]
async fn waiting_on_an_approval_is_not_a_stall() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let mut harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-rm",
                "bash",
                json!({ "command": "rm -rf dist" }),
            )),
            Ok(text("ok")),
        ],
        runners: vec![Arc::new(Bash { ran })],
        timeout_ms: Some(60_000),
        ..Setup::default()
    });
    harness.core = harness.core.with_stall_after(Duration::from_millis(30));
    harness.core.receive(message("clean")).expect("receive");
    let request = wait_for_requested(&harness).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let events = harness.core.events("t1").expect("events");
    assert!(events.iter().all(|event| event.kind != "turn.stalled"));
    harness
        .core
        .receive(approval(&request, ApprovalDecision::Deny))
        .expect("answer");
    harness.core.idle().await;
}

#[tokio::test]
async fn nothing_to_report_before_a_refused_command_in_the_same_reply_is_not_quiet() {
    let harness = setup(Setup {
        replies: vec![
            Ok(LlmReply {
                content: vec![
                    json!({ "type": "tool_use", "id": "u1", "name": "nothing_to_report", "input": {} }),
                    json!({ "type": "tool_use", "id": "u2", "name": "bash", "input": { "command": "rm -rf build" } }),
                ],
                stop_reason: Some("tool_use".into()),
            }),
            Ok(text("I could not clean build/")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::new(Mutex::new(Vec::new())),
        })],
        ..Setup::default()
    });
    harness.core.receive(round(false, &[])).expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t9").expect("events");
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_schedule_is_named_from_its_words_as_a_task_is() {
    let harness = setup(Setup {
        replies: vec![Ok(text("\"Check MEMORY.md daily\"\nmore"))],
        ..Setup::default()
    });
    harness
        .core
        .receive(ToWorker::TitleTrigger {
            id: "tr_1".into(),
            text: "Read MEMORY.md and tell me what needs updating".into(),
        })
        .expect("receive");
    for _ in 0..100 {
        if harness
            .link
            .take()
            .iter()
            .any(|message| matches!(message, FromWorker::TriggerTitled { .. }))
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert_eq!(
        harness.link.last(),
        Some(FromWorker::TriggerTitled {
            id: "tr_1".into(),
            title: "Check MEMORY.md daily".into(),
        })
    );
}

#[tokio::test]
async fn a_round_past_its_time_limit_ends_as_a_stop_that_says_why() {
    let harness = setup(Setup {
        gated: true,
        ..Setup::default()
    });
    let ToWorker::Run {
        task,
        member,
        text,
        mut trigger,
    } = round(false, &[])
    else {
        unreachable!()
    };
    trigger.limit_s = Some(1);
    harness
        .core
        .receive(ToWorker::Run {
            task,
            member,
            text,
            trigger,
        })
        .expect("receive");
    harness.core.idle().await;
    let events = harness.core.events("t9").expect("events");
    assert_eq!(
        events.last().expect("last").body,
        json!({ "reason": "stopped", "code": "trigger.time_limit" })
    );
}

#[tokio::test]
async fn any_turn_may_propose_idle_work_and_the_supervisor_hears_it() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "u1",
                "propose_idle_work",
                json!({ "items": ["write the parser tests", " "] }),
            )),
            Ok(text("noted")),
        ],
        ..Setup::default()
    });
    harness.core.receive(message("hi")).expect("receive");
    harness.core.idle().await;
    assert!(harness.link.take().iter().any(|sent| matches!(
        sent,
        FromWorker::IdleProposed { items } if items == &vec!["write the parser tests".to_string()]
    )));
    assert!(tool_names(&harness.llm.requests()[0]).contains(&"propose_idle_work".to_string()));
}

// ---- Turns at once and the write lock (ADR 0080) ----

/// An LLM that answers each Task from its own script, so Turns that run at once
/// do not take each other's replies. A Task's `hold`-th request waits for its gate.
#[derive(Default)]
struct ByTask {
    replies: Mutex<std::collections::HashMap<String, VecDeque<LlmReply>>>,
    holds: Mutex<std::collections::HashMap<String, (usize, watch::Receiver<bool>)>>,
    asked: Mutex<std::collections::HashMap<String, usize>>,
}

impl ByTask {
    fn script(&self, task: &str, replies: Vec<LlmReply>) {
        self.replies
            .lock()
            .unwrap()
            .insert(task.into(), replies.into());
    }

    /// The `nth` request of `task` (0 is the first) waits until the returned gate opens.
    fn hold(&self, task: &str, nth: usize) -> watch::Sender<bool> {
        let (open, gate) = watch::channel(false);
        self.holds.lock().unwrap().insert(task.into(), (nth, gate));
        open
    }
}

#[async_trait]
impl Llm for ByTask {
    async fn send(&self, request: LlmRequest, _cancel: &Cancel) -> Result<LlmReply, LlmError> {
        if is_title(&request) {
            return Err(LlmError::Failed("unnamed".into()));
        }
        let nth = {
            let mut asked = self.asked.lock().unwrap();
            let count = asked.entry(request.task.clone()).or_default();
            *count += 1;
            *count - 1
        };
        let gate = self
            .holds
            .lock()
            .unwrap()
            .get(&request.task)
            .filter(|(at, _)| *at == nth)
            .map(|(_, gate)| gate.clone());
        if let Some(mut gate) = gate {
            while !*gate.borrow() {
                if gate.changed().await.is_err() {
                    break;
                }
            }
        }
        let reply = self
            .replies
            .lock()
            .unwrap()
            .get_mut(&request.task)
            .and_then(VecDeque::pop_front)
            .unwrap_or_else(|| text("ok"));
        // A reply that says FAIL is the Provider failing.
        if reply.content.first().and_then(|block| block.get("text")) == Some(&json!("FAIL")) {
            return Err(LlmError::Failed("down".into()));
        }
        Ok(reply)
    }
}

/// Tools that only say they ran: `write`, `read`, `memory`, and a `bash` that
/// writes its command down. `memory` takes a moment, to catch two at once.
struct Recorder {
    ran: Arc<Mutex<Vec<String>>>,
    in_memory: Arc<std::sync::atomic::AtomicUsize>,
    most_in_memory: Arc<std::sync::atomic::AtomicUsize>,
}

#[async_trait]
impl ToolRunner for Recorder {
    fn definitions(&self) -> Vec<ToolDefinition> {
        ["write", "read", "memory", "bash"]
            .into_iter()
            .map(definition)
            .collect()
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        use std::sync::atomic::Ordering;
        let what = input
            .get("command")
            .or_else(|| input.get("path"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        self.ran.lock().unwrap().push(format!("{name}:{what}"));
        if name == "memory" {
            let now = self.in_memory.fetch_add(1, Ordering::SeqCst) + 1;
            self.most_in_memory.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(40)).await;
            self.in_memory.fetch_sub(1, Ordering::SeqCst);
        }
        Ok("done".into())
    }
}

struct Lanes {
    core: AgentCore,
    llm: Arc<ByTask>,
    ran: Arc<Mutex<Vec<String>>>,
    most_in_memory: Arc<std::sync::atomic::AtomicUsize>,
}

fn lanes(allowlist: &[&str], stall_after: Option<Duration>) -> Lanes {
    let dir = tempdir().expect("tempdir");
    let store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    let ran = Arc::new(Mutex::new(Vec::new()));
    let most_in_memory = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut tools = ToolRegistry::default();
    tools
        .register(Arc::new(Recorder {
            ran: Arc::clone(&ran),
            in_memory: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            most_in_memory: Arc::clone(&most_in_memory),
        }))
        .expect("tools");
    let llm = Arc::new(ByTask::default());
    let core = AgentCore::new(
        "Deployer",
        store,
        Arc::clone(&llm) as Arc<dyn Llm>,
        tools,
        Arc::new(RecordingLink::default()) as Arc<dyn SupervisorLink>,
    );
    core.set_allowlist(allowlist.iter().map(|entry| entry.to_string()).collect());
    let core = match stall_after {
        Some(after) => core.with_stall_after(after),
        None => core,
    };
    std::mem::forget(dir);
    Lanes {
        core,
        llm,
        ran,
        most_in_memory,
    }
}

impl Lanes {
    fn ran(&self) -> Vec<String> {
        self.ran.lock().unwrap().clone()
    }

    fn has(&self, task: &str, kind: &str) -> bool {
        self.core
            .events(task)
            .map(|events| events.iter().any(|event| event.kind == kind))
            .unwrap_or(false)
    }

    async fn until(&self, done: impl Fn(&Self) -> bool, what: &str) {
        for _ in 0..500 {
            if done(self) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        panic!("never: {what}");
    }
}

#[tokio::test]
async fn turns_of_two_tasks_run_at_once_and_a_tasks_own_message_still_waits() {
    let lanes = lanes(&[], None);
    let open_a = lanes.llm.hold("a", 0);
    lanes
        .core
        .receive(message_in("a", "first in a", "m_owner"))
        .expect("a");
    lanes
        .core
        .receive(message_in("b", "first in b", "m_owner"))
        .expect("b");
    lanes
        .core
        .receive(message_in("a", "second in a", "m_owner"))
        .expect("a again");
    // B starts and ends while A's first Turn is still waiting on its LLM.
    lanes
        .until(|lanes| lanes.has("b", "turn.ended"), "b ends")
        .await;
    let a = lanes.core.events("a").expect("events");
    assert_eq!(
        a.iter()
            .filter(|event| event.kind == "turn.started")
            .count(),
        1
    );
    assert!(!a.iter().any(|event| event.kind == "turn.ended"));
    // A's second message waited for A's own Turn, and then ran.
    let _ = open_a.send(true);
    lanes.core.idle().await;
    let a = lanes.core.events("a").expect("events");
    assert_eq!(
        a.iter().filter(|event| event.kind == "turn.ended").count(),
        2
    );
}

#[tokio::test]
async fn a_turn_reads_while_another_writes_and_waits_only_to_write() {
    let lanes = lanes(&["npm"], None);
    // A writes, then waits on its LLM while it still holds the lock.
    lanes.llm.script(
        "a",
        vec![
            tool_use("w", "write", json!({ "path": "a.txt" })),
            text("a done"),
        ],
    );
    let open_a = lanes.llm.hold("a", 1);
    lanes.llm.script(
        "b",
        vec![
            tool_use("r", "read", json!({ "path": "a.txt" })),
            tool_use("ls", "bash", json!({ "command": "ls" })),
            tool_use("m", "memory", json!({ "text": "note" })),
            text("b done"),
        ],
    );
    lanes.llm.script(
        "c",
        vec![
            tool_use("t", "bash", json!({ "command": "npm test" })),
            text("c done"),
        ],
    );
    lanes
        .core
        .receive(message_in("a", "write it", "m_owner"))
        .expect("a");
    lanes
        .until(
            |lanes| lanes.ran().contains(&"write:a.txt".to_string()),
            "a writes",
        )
        .await;
    lanes
        .core
        .receive(message_in("b", "look", "m_owner"))
        .expect("b");
    lanes
        .core
        .receive(message_in("c", "test", "m_owner"))
        .expect("c");
    // B reads, lists and writes memory without waiting; C's command waits for A.
    lanes
        .until(|lanes| lanes.has("b", "turn.ended"), "b ends")
        .await;
    assert!(lanes.ran().contains(&"read:a.txt".to_string()));
    assert!(lanes.ran().contains(&"bash:ls".to_string()));
    assert!(lanes.ran().contains(&"memory:".to_string()));
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!lanes.ran().contains(&"bash:npm test".to_string()));
    let _ = open_a.send(true);
    lanes.core.idle().await;
    assert!(lanes.ran().contains(&"bash:npm test".to_string()));
    assert!(lanes.has("c", "turn.ended"));
}

#[tokio::test]
async fn a_turn_waiting_to_write_can_be_stopped_and_is_not_stalled_meanwhile() {
    let lanes = lanes(&[], Some(Duration::from_millis(40)));
    lanes.llm.script(
        "a",
        vec![
            tool_use("w", "write", json!({ "path": "a.txt" })),
            text("a done"),
        ],
    );
    let open_a = lanes.llm.hold("a", 1);
    lanes.llm.script(
        "c",
        vec![
            tool_use("w2", "write", json!({ "path": "c.txt" })),
            text("c done"),
        ],
    );
    lanes
        .core
        .receive(message_in("a", "write a", "m_owner"))
        .expect("a");
    lanes
        .until(
            |lanes| lanes.ran().contains(&"write:a.txt".to_string()),
            "a writes",
        )
        .await;
    lanes
        .core
        .receive(message_in("c", "write c", "m_owner"))
        .expect("c");
    // Well past the stall time, C is waiting for the lock, not stalled.
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(!lanes.has("c", "turn.stalled"));
    lanes.core.receive(stop_in("c", "stop-c")).expect("stop");
    lanes
        .until(|lanes| lanes.has("c", "turn.ended"), "c ends")
        .await;
    let ended = lanes
        .core
        .events("c")
        .expect("events")
        .into_iter()
        .find(|event| event.kind == "turn.ended")
        .expect("ended");
    assert_eq!(ended.body["reason"], "stopped");
    assert!(!lanes.ran().contains(&"write:c.txt".to_string()));
    // A still holds the lock and goes on.
    let _ = open_a.send(true);
    lanes.core.idle().await;
    assert!(lanes.has("a", "turn.ended"));
}

#[tokio::test]
async fn two_turns_writing_memory_at_once_each_land_whole() {
    let lanes = lanes(&[], None);
    lanes
        .llm
        .script("a", vec![tool_use("m1", "memory", json!({})), text("a")]);
    lanes
        .llm
        .script("b", vec![tool_use("m2", "memory", json!({})), text("b")]);
    lanes
        .core
        .receive(message_in("a", "remember a", "m_owner"))
        .expect("a");
    lanes
        .core
        .receive(message_in("b", "remember b", "m_owner"))
        .expect("b");
    lanes.core.idle().await;
    let memory_calls = lanes
        .ran()
        .iter()
        .filter(|call| call.starts_with("memory"))
        .count();
    assert_eq!(memory_calls, 2);
    assert_eq!(
        lanes
            .most_in_memory
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[tokio::test]
async fn a_turn_that_fails_while_holding_the_lock_lets_the_next_writer_in() {
    let lanes = lanes(&[], None);
    // A writes, then its Provider fails while it holds the lock.
    lanes.llm.script(
        "a",
        vec![
            tool_use("w", "write", json!({ "path": "a.txt" })),
            text("FAIL"),
        ],
    );
    lanes.llm.script(
        "b",
        vec![
            tool_use("w2", "write", json!({ "path": "b.txt" })),
            text("b"),
        ],
    );
    lanes
        .core
        .receive(message_in("a", "write a", "m_owner"))
        .expect("a");
    lanes
        .core
        .receive(message_in("b", "write b", "m_owner"))
        .expect("b");
    lanes.core.idle().await;
    assert!(lanes.ran().contains(&"write:a.txt".to_string()));
    assert!(lanes.ran().contains(&"write:b.txt".to_string()));
    let ended = lanes
        .core
        .events("a")
        .expect("events")
        .into_iter()
        .rev()
        .find(|event| event.kind == "turn.ended")
        .expect("ended");
    assert_eq!(ended.body["reason"], "error");
}

#[tokio::test]
async fn a_quiet_turn_is_stalled_even_while_another_task_is_busy() {
    let lanes = lanes(&[], Some(Duration::from_millis(40)));
    let open_a = lanes.llm.hold("a", 0);
    lanes
        .core
        .receive(message_in("a", "slow", "m_owner"))
        .expect("a");
    // B keeps writing events while A says nothing.
    for round in 0..6 {
        lanes
            .core
            .receive(message_in("b", &format!("busy {round}"), "m_owner"))
            .expect("b");
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    lanes
        .until(|lanes| lanes.has("a", "turn.stalled"), "a is stalled")
        .await;
    assert!(!lanes.has("b", "turn.stalled"));
    let _ = open_a.send(true);
    lanes.core.idle().await;
}

/// Answers with the token of the Turn it was called from.
struct WhoAmI;

#[async_trait]
impl ToolRunner for WhoAmI {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![definition("whoami")]
    }

    async fn run(
        &self,
        _name: &str,
        _input: &Value,
        _cancel: &Cancel,
    ) -> Result<String, ToolError> {
        Ok(veeloe_plugin_api::turn_token().unwrap_or_default())
    }
}

#[tokio::test]
async fn each_turn_tells_the_supervisor_its_proxy_token_and_its_tools_carry_it() {
    let harness = setup(Setup {
        runners: vec![Arc::new(WhoAmI)],
        allowlist: vec!["whoami".into()],
        replies: vec![
            Ok(tool_use("u1", "whoami", json!({}))),
            Ok(text("first")),
            Ok(text("second")),
        ],
        ..Setup::default()
    });
    harness.core.receive(message("one")).expect("one");
    harness.core.idle().await;
    harness.core.receive(message("two")).expect("two");
    harness.core.idle().await;
    let tokens: Vec<(String, String)> = harness
        .link
        .take()
        .into_iter()
        .filter_map(|message| match message {
            FromWorker::TurnProxy { task, token } => Some((task, token)),
            _ => None,
        })
        .collect();
    assert_eq!(tokens.len(), 2);
    assert!(tokens
        .iter()
        .all(|(task, token)| task == "t1" && token.len() > 8));
    assert_ne!(tokens[0].1, tokens[1].1, "every Turn has its own token");
    // The tool saw the first Turn's token, and the log never holds it.
    let events = harness.core.events("t1").expect("events");
    let result = events
        .iter()
        .find(|event| event.kind == "tool.result")
        .expect("result");
    assert_eq!(result.body["content"][0]["content"], json!(tokens[0].1));
    let without_results: Vec<_> = events
        .iter()
        .filter(|event| event.kind != "tool.result")
        .collect();
    assert!(!serde_json::to_string(&without_results)
        .unwrap()
        .contains(&tokens[0].1));
}

fn card_id(harness: &Harness) -> String {
    harness
        .core
        .events("t1")
        .expect("events")
        .iter()
        .find(|event| event.kind == "card.shown")
        .and_then(|event| event.body["id"].as_str().map(str::to_string))
        .expect("a card")
}

fn card_answer(id: &str, member: &str, answer: Value) -> ToWorker {
    ToWorker::CardAnswer {
        task: "t1".into(),
        id: id.into(),
        answer,
        member: member.into(),
        reference: format!("sig-{id}-{member}"),
    }
}

#[tokio::test]
async fn a_question_waits_for_the_turns_own_member_and_their_answer_is_the_tool_result() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-ask",
                "ask_choice",
                json!({ "question": "Where to deploy?", "options": ["staging", "production"] }),
            )),
            Ok(text("deploying to staging")),
        ],
        ..Setup::default()
    });
    harness.core.receive(message("deploy")).expect("receive");
    wait_for_kind(&harness, "t1", "card.shown").await;
    let id = card_id(&harness);
    let shown = harness.core.events("t1").expect("events");
    let card = shown
        .iter()
        .find(|event| event.kind == "card.shown")
        .expect("shown");
    assert_eq!(card.body["card"], "ask_choice");
    assert_eq!(card.body["member"], "m_owner");
    assert_eq!(
        card.body["fallback"],
        "Where to deploy?\n1. staging\n2. production"
    );

    // Somebody else cannot answer it; the Question still waits.
    harness
        .core
        .receive(card_answer(&id, "m_other", json!("production")))
        .expect("other");
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !kinds(&harness.core.events("t1").expect("events")).contains(&"card.answered".to_string())
    );

    harness
        .core
        .receive(card_answer(&id, "m_owner", json!("staging")))
        .expect("answer");
    harness.core.idle().await;
    let events = harness.core.events("t1").expect("events");
    let answered = events
        .iter()
        .find(|event| event.kind == "card.answered")
        .expect("answered");
    assert_eq!(
        answered.body,
        json!({ "id": id, "member": "m_owner", "answer": "staging" })
    );
    let requests = harness.llm.requests();
    let content = requests[1].messages.last().expect("last").content[0]["content"]
        .as_str()
        .expect("content")
        .to_string();
    assert!(content.contains("\"staging\""));
}

#[tokio::test]
async fn a_question_nobody_answers_lets_the_agent_carry_on_and_a_bad_one_names_its_field() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-bad",
                "ask_choice",
                json!({ "options": ["a"] }),
            )),
            Ok(tool_use(
                "tu-ask",
                "ask_choice",
                json!({ "question": "Which?" }),
            )),
            Ok(text("went with my own pick")),
        ],
        timeout_ms: Some(30),
        ..Setup::default()
    });
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;
    let requests = harness.llm.requests();
    let bad = requests[1].messages.last().expect("last").content[0].clone();
    assert_eq!(bad["is_error"], true);
    assert!(bad["content"]
        .as_str()
        .expect("content")
        .contains("question: required"));
    let late = requests[2].messages.last().expect("last").content[0]["content"]
        .as_str()
        .expect("content")
        .to_string();
    assert!(late.contains("Nobody answered in time"));
    let events = harness.core.events("t1").expect("events");
    let answered = events
        .iter()
        .find(|event| event.kind == "card.answered")
        .expect("answered");
    assert_eq!(answered.body["expired"], true);
}

#[tokio::test]
async fn a_round_nobody_watches_cannot_ask_a_question() {
    let harness = setup(Setup {
        replies: vec![Ok(tool_use("u3", "nothing_to_report", json!({})))],
        ..Setup::default()
    });
    harness.core.receive(round(false, &[])).expect("receive");
    harness.core.idle().await;
    let names = tool_names(&harness.llm.requests()[0]);
    assert!(!names.contains(&"ask_choice".to_string()));
    assert!(!names.contains(&"ask_form".to_string()));
}

#[tokio::test]
async fn a_schedule_with_a_goal_may_note_progress_and_say_it_is_met() {
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "g1",
                "goal_note",
                json!({ "note": "PR #41 still open" }),
            )),
            Ok(tool_use(
                "g2",
                "goal_met",
                json!({ "reason": "PR #41 merged" }),
            )),
            Ok(text("done")),
        ],
        ..Setup::default()
    });
    let mut run = scheduled("t1");
    if let ToWorker::Run { trigger, .. } = &mut run {
        trigger.goal = true;
    }
    harness.core.receive(run).expect("receive");
    harness.core.idle().await;
    assert!(tool_names(&harness.llm.requests()[0]).contains(&"goal_met".to_string()));
    let events = harness.core.events("t1").expect("events");
    let body = |kind: &str| {
        events
            .iter()
            .find(|event| event.kind == kind)
            .map(|event| event.body.clone())
    };
    assert_eq!(
        body("goal.noted"),
        Some(json!({ "note": "PR #41 still open" }))
    );
    assert_eq!(body("goal.met"), Some(json!({ "reason": "PR #41 merged" })));
}

#[tokio::test]
async fn a_schedule_without_a_goal_has_no_goal_tools() {
    let harness = setup(Setup {
        replies: vec![Ok(text("checked"))],
        ..Setup::default()
    });
    harness.core.receive(scheduled("t1")).expect("receive");
    harness.core.idle().await;
    let names = tool_names(&harness.llm.requests()[0]);
    assert!(!names.contains(&"goal_note".to_string()) && !names.contains(&"goal_met".to_string()));
}
