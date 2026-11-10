//! The tests of `packages/runtime-legacy/src/worker/core/agent.test.ts`, ported
//! to the Rust core. Same names, same expectations: a Stop, an Approval and the
//! Allowlist must behave the way the log already says they do.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::sync::watch;
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRegistry, ToolRunner};
use veeloe_runtime_core::{
    conversation, AgentCore, ApprovalDecision, EventStore, FromWorker, Llm, LlmError, LlmReply,
    LlmRequest, SupervisorLink, TaskEvent, ToWorker,
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
        .filter(|event| event.kind != "context.usage")
        .map(|event| event.kind.clone())
        .collect()
}

fn requested_of(harness: &Harness) -> Option<String> {
    harness
        .link
        .take()
        .into_iter()
        .find_map(|message| match message {
            FromWorker::Event { event, .. } if event.kind == "approval.requested" => event.body
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
        vec!["member.message", "turn.started", "llm.message", "turn.ended"]
    );
    let seqs: Vec<i64> = events
        .iter()
        .filter(|event| event.kind != "context.usage")
        .map(|event| event.seq)
        .collect();
    assert_eq!(seqs, vec![1, 2, 4, 5]);
    assert!(harness.link.take().iter().all(|message| matches!(
        message,
        FromWorker::Event { starter, .. } if starter == "m_owner"
    )));
    assert_eq!(events.last().expect("last").body, json!({ "reason": "done" }));
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
async fn a_message_during_a_turn_is_refused_as_busy_and_leaves_the_log_alone() {
    let harness = setup(Setup {
        gated: true,
        ..Setup::default()
    });
    harness.core.receive(message("first")).expect("first");
    harness.core.receive(message("second")).expect("second");
    assert_eq!(
        harness.link.last(),
        Some(FromWorker::Error {
            member: "m_owner".into(),
            reference: "sig-second".into(),
            code: "agent.busy".into(),
            task: Some("t1".into()),
        })
    );
    let _ = harness.gate.send(true);
    harness.core.idle().await;
    assert!(!harness
        .core
        .events("t1")
        .expect("events")
        .iter()
        .any(|event| event.body.get("text").and_then(Value::as_str) == Some("second")));
}

#[tokio::test]
async fn a_new_name_reaches_the_next_turn_and_the_turn_running_keeps_the_old_one() {
    let harness = setup(Setup {
        replies: vec![Ok(tool_use("u1", "echo", json!({}))), Ok(text("done")), Ok(text("done"))],
        runners: vec![Arc::new(Echo)],
        allowlist: vec!["echo".into()],
        gated: true,
        ..Setup::default()
    });
    harness.core.receive(message("first")).expect("receive");
    harness.core.rename("Builder");
    let _ = harness.gate.send(true);
    harness.core.idle().await;
    harness.core
        .receive(message_in("t2", "second", "m_owner"))
        .expect("second");
    harness.core.idle().await;

    let systems: Vec<String> = harness
        .llm
        .requests()
        .iter()
        .map(|request| request.system.split(',').next().unwrap_or_default().to_string())
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
        core.events("t1").expect("events").last().expect("last").body,
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

fn bash_harness(replies: Vec<Result<LlmReply, LlmError>>, allowlist: Vec<String>) -> (Harness, Arc<Mutex<Vec<String>>>) {
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
            Ok(tool_use("tu-ls", "bash", json!({ "command": "ls -la" }))),
            Ok(text("done")),
        ],
        vec!["ls".into()],
    );
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(*ran.lock().expect("ran"), vec!["ls -la"]);
    assert!(!kinds(&harness.core.events("t1").expect("events")).contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn an_approved_command_runs_and_the_log_holds_the_approval_pair() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
        harness.core.events("t1").expect("events").last().expect("last").body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_redirect_tells_the_llm_what_to_do_instead() {
    let (harness, ran) = bash_harness(
        vec![
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
async fn a_new_allowlist_reaches_the_next_tool_call() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("tu-ls", "bash", json!({ "command": "ls" }))),
            Ok(text("done")),
        ],
        runners: vec![Arc::new(Bash {
            ran: Arc::clone(&ran),
        })],
        ..Setup::default()
    });
    harness.core.set_allowlist(vec!["ls".into()]);
    harness.core.receive(message("go")).expect("receive");
    harness.core.idle().await;

    assert_eq!(*ran.lock().expect("ran"), vec!["ls"]);
    assert!(!kinds(&harness.core.events("t1").expect("events")).contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn a_connector_tool_outside_the_allowlist_waits_too_and_an_exact_name_runs_it() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use(
                "tu-pr",
                "github/create_pull_request",
                json!({}),
            )),
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
    assert!(!kinds(&harness.core.events("t1").expect("events")).contains(&"approval.requested".to_string()));
}

#[tokio::test]
async fn an_answer_for_another_task_is_approval_unknown() {
    let (harness, _ran) = bash_harness(
        vec![
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
        harness.core.events("t1").expect("events").last().expect("last").body,
        json!({ "reason": "done" })
    );
}

#[tokio::test]
async fn a_new_timeout_reaches_the_next_wait_and_a_bad_value_keeps_the_old_one() {
    let ran = Arc::new(Mutex::new(Vec::new()));
    let harness = setup(Setup {
        replies: vec![
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
async fn a_stop_ends_the_turn_with_who_stopped_it_and_the_task_goes_on_from_the_same_conversation() {
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
        harness.core.events("t1").expect("events").last().expect("last").body,
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
        harness.core.events("t1").expect("events").last().expect("last").body,
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
        vec!["member.message", "turn.started", "turn.stopped", "turn.ended"]
    );
    assert_eq!(
        harness.core.events("t1").expect("events").last().expect("last").body,
        json!({ "reason": "stopped" })
    );
    // The answer is not written as this Turn's words.
    assert!(!harness
        .link
        .take()
        .iter()
        .any(|message| matches!(message, FromWorker::Event { event, .. } if event.kind == "llm.message")));
}

#[tokio::test]
async fn a_stop_while_an_approval_waits_ends_the_turn_and_a_late_answer_is_approval_unknown() {
    let (harness, _ran) = bash_harness(
        vec![
            Ok(tool_use("tu-rm", "bash", json!({ "command": "rm -rf dist" }))),
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
        harness.core.events("t1").expect("events").last().expect("last").body,
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
async fn a_stop_with_no_turn_running_is_turn_not_running_and_one_for_another_task_is_task_not_found() {
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
        .append("t-open", "turn.started", &json!({ "member": "m_owner" }), None)
        .expect("start");
    store.create_task("t-done", "m_owner").expect("task");
    store
        .append("t-done", "turn.started", &json!({ "member": "m_owner" }), None)
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
    assert_eq!(open[open.len() - 1].body, json!({ "reason": "interrupted" }));
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
        core.events("t-open").expect("events").last().expect("last").body,
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
        replies: vec![Ok(text("The earlier work was about a release.")), Ok(text("done"))],
        context_window: Some(100),
        ..Setup::default()
    });
    harness.core.receive(message(&"x".repeat(500))).expect("receive");
    harness.core.idle().await;

    let requests = harness.llm.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].system.contains("compact"));
    let second = &requests[1].messages[0];
    assert!(second.content.iter().any(|block| block["text"].as_str().is_some_and(|text| text.contains("The earlier work"))));
    let events = harness.core.events("t1").expect("events");
    assert!(events.iter().any(|event| event.kind == "context.compacted"));
}
