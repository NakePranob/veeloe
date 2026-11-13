//! The headless runtime: one Agent's worker, driven over its IPC the way the
//! supervisor drives it, with the Provider faked.
//!
//! The second test holds the port to the legacy Runtime itself: the expected log
//! in `fixtures/legacy-task-log.json` was recorded by running the same
//! conversation through `packages/runtime-legacy/src/worker/core/agent.ts`.

use std::collections::VecDeque;
use std::fs;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{json, Value};
use tempfile::tempdir;
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRegistry, ToolRunner};
use veeloe_runtime_core::{
    AgentCore, EventStore, FromWorker, Llm, LlmError, LlmReply, LlmRequest, LogAnswer,
    LogQuery, StoreError, SupervisorLink, TaskEvent, ToWorker,
};
use veeloe_runtime_worker::worker::{Config, Worker};

/// A supervisor in the test's pocket: it records what the worker says, and
/// answers each LLM request with the next canned body.
struct ChannelLink(std::sync::mpsc::Sender<FromWorker>);

impl SupervisorLink for ChannelLink {
    fn send(&self, message: FromWorker) {
        let _ = self.0.send(message);
    }
}

fn answer(id: &str, body: Value) -> ToWorker {
    ToWorker::LlmResponse {
        id: id.to_string(),
        status: 200,
        headers: vec![("content-type".into(), "application/json".into())],
        body: body.to_string(),
    }
}

/// The supervisor's side of the log, in the test's pocket: one SQLite store,
/// written only here. The worker gets no file (ADR 0069).
struct FakeLog {
    store: Mutex<EventStore>,
}

impl FakeLog {
    fn new(dir: &std::path::Path) -> Self {
        Self {
            store: Mutex::new(EventStore::open(dir.join("tasks.db")).expect("log")),
        }
    }

    fn answer(&self, query: LogQuery) -> Result<LogAnswer, String> {
        let store = self.store.lock().expect("log");
        let code = |error: StoreError| error.to_string();
        match query {
            LogQuery::Starter { task } => Ok(LogAnswer::Starter {
                starter: store.starter_of(&task).map_err(code)?,
            }),
            LogQuery::HasMessage { id } => Ok(LogAnswer::HasMessage {
                seen: store.has_message(&id).map_err(code)?,
            }),
            LogQuery::Events { task, after } => Ok(LogAnswer::Events {
                events: store.events(&task, after).map_err(code)?,
            }),
            LogQuery::TasksStartedBy { member } => Ok(LogAnswer::TasksStartedBy {
                tasks: store.tasks_started_by(&member).map_err(code)?,
            }),
            LogQuery::OpenTurns => Ok(LogAnswer::OpenTurns {
                tasks: store.open_turns().map_err(code)?,
            }),
        }
    }

    fn append(
        &self,
        task: &str,
        starter: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, String> {
        let mut store = self.store.lock().expect("log");
        store
            .ensure_task(task, starter)
            .map_err(|error| error.to_string())?;
        store
            .append(task, kind, body, message_id)
            .map_err(|error| error.to_string())
    }
}

// The worker waits on the supervisor's answer to each log request, and the
// answer comes from another thread: a pocket supervisor runs on its own, the
// way the real one runs in another process.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_worker_loop_runs_a_task_end_to_end_with_a_fake_supervisor() {
    let root = tempdir().expect("tempdir");
    fs::create_dir_all(root.path().join("workdir")).expect("workdir");
    fs::write(root.path().join("workdir/note.txt"), "hello").expect("note");

    let (sending, said) = std::sync::mpsc::channel();
    let worker = Worker::new(
        Config::new(root.path(), "Deployer"),
        Arc::new(ChannelLink(sending)),
    )
    .expect("worker");

    // The supervisor, in the test's pocket: it answers each LLM request with the
    // next canned body, answers the Task log's requests, and keeps what the
    // worker asked for.
    let answering = worker.clone();
    let log = FakeLog::new(root.path());
    let requests: Arc<Mutex<Vec<(Vec<(String, String)>, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let heard = Arc::clone(&requests);
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopping = Arc::clone(&done);
    let supervisor = std::thread::spawn(move || {
        let mut bodies = VecDeque::from([
            json!({
                "content": [{ "type": "tool_use", "id": "tu1", "name": "read", "input": { "path": "note.txt" } }],
                "stop_reason": "tool_use",
            }),
            json!({
                "content": [{ "type": "text", "text": "done" }],
                "stop_reason": "end_turn",
            }),
        ]);
        while !stopping.load(std::sync::atomic::Ordering::SeqCst) {
            let Ok(message) = said.recv_timeout(std::time::Duration::from_millis(20)) else {
                continue;
            };
            match message {
                FromWorker::LlmRequest {
                    id, headers, body, ..
                } => {
                    heard.lock().expect("requests").push((headers, body));
                    let next = bodies.pop_front().expect("a canned answer");
                    answering.receive(answer(&id, next)).expect("answer");
                }
                FromWorker::LogAppend {
                    id,
                    task,
                    starter,
                    kind,
                    body,
                    message_id,
                } => {
                    let reply =
                        match log.append(&task, &starter, &kind, &body, message_id.as_deref()) {
                            Ok(event) => ToWorker::LogAppended { id, event },
                            Err(code) => ToWorker::LogFailed { id, code },
                        };
                    answering.receive(reply).expect("log answer");
                }
                FromWorker::LogRead { id, query } => {
                    let reply = match log.answer(query) {
                        Ok(answer) => ToWorker::LogAnswer { id, answer },
                        Err(code) => ToWorker::LogFailed { id, code },
                    };
                    answering.receive(reply).expect("log answer");
                }
                _ => {}
            }
        }
    });

    // After the pocket supervisor is listening: the first thing the worker asks
    // is which Turns a restart left open.
    worker.start().expect("start");
    worker
        .receive(ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        })
        .expect("receive");
    worker.idle().await;

    let events = worker.events("t1").expect("events");
    let kinds: Vec<&str> = events
        .iter()
        .filter(|event| event.kind != "context.usage")
        .map(|event| event.kind.as_str())
        .collect();
    assert_eq!(
        kinds,
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "tool.result",
            "llm.message",
            "turn.ended",
        ]
    );
    // The real `read` tool ran inside the Workdir, and its answer went back.
    let shown: Vec<_> = events
        .iter()
        .filter(|event| event.kind != "context.usage")
        .collect();
    assert_eq!(shown[3].body["content"][0]["content"], "1\thello");
    assert_eq!(shown[5].body["reason"], "done");

    done.store(true, std::sync::atomic::Ordering::SeqCst);
    supervisor.join().expect("supervisor");
    let requests = requests.lock().expect("requests").clone();
    assert_eq!(requests.len(), 2);
    // The worker names the Task and never carries a key: the supervisor holds it.
    assert_eq!(
        veeloe_runtime_core::header(&requests[0].0, "x-veeloe-task"),
        Some("t1")
    );
    assert_eq!(
        veeloe_runtime_core::header(&requests[0].0, "x-api-key"),
        None
    );
    let sent: Value = serde_json::from_str(&requests[0].1).expect("json");
    assert_eq!(sent["model"], "agent");
    assert_eq!(sent["stream"], true);
}

// ---------------------------------------------------------------- the golden log

struct Echo;

#[async_trait]
impl ToolRunner for Echo {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "echo".into(),
            description: "echo".into(),
            input_schema: json!({ "type": "object" }),
        }]
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        if name != "echo" {
            return Err(ToolError::Unknown(name.into()));
        }
        Ok(input.to_string())
    }
}

struct CannedLlm {
    replies: Mutex<VecDeque<LlmReply>>,
}

#[async_trait]
impl Llm for CannedLlm {
    async fn send(&self, _request: LlmRequest, _cancel: &Cancel) -> Result<LlmReply, LlmError> {
        self.replies
            .lock()
            .expect("replies")
            .pop_front()
            .ok_or_else(|| LlmError::Failed("no more replies".into()))
    }
}

struct Nowhere;

impl SupervisorLink for Nowhere {
    fn send(&self, _message: FromWorker) {}
}

#[tokio::test]
async fn the_same_conversation_writes_the_log_the_legacy_runtime_writes() {
    let dir = tempdir().expect("tempdir");
    let store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    let mut tools = ToolRegistry::default();
    tools.register(Arc::new(Echo)).expect("tool");
    let llm = CannedLlm {
        replies: Mutex::new(VecDeque::from([
            LlmReply {
                content: vec![json!({ "type": "tool_use", "id": "tu1", "name": "echo", "input": { "a": 1 } })],
                stop_reason: Some("tool_use".into()),
            },
            LlmReply {
                content: vec![json!({ "type": "text", "text": "done" })],
                stop_reason: Some("end_turn".into()),
            },
        ])),
    };
    let agent = AgentCore::new(
        "Deployer",
        store,
        Arc::new(llm) as Arc<dyn Llm>,
        tools,
        Arc::new(Nowhere) as Arc<dyn SupervisorLink>,
    );
    agent.set_allowlist(vec!["echo".into()]);
    agent
        .receive(ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        })
        .expect("receive");
    agent.idle().await;

    #[derive(serde::Deserialize)]
    struct LegacyEvent {
        kind: String,
        body: Value,
    }
    let expected: Vec<LegacyEvent> =
        serde_json::from_str(include_str!("fixtures/legacy-task-log.json")).expect("fixture");
    let events = agent.events("t1").expect("events");
    let actual: Vec<_> = events
        .iter()
        .filter(|event| event.kind != "context.usage")
        .collect();
    assert_eq!(actual.len(), expected.len(), "the port wrote a different number of events");
    for (index, (port, legacy)) in actual.iter().zip(expected.iter()).enumerate() {
        assert_eq!(port.kind, legacy.kind, "event {index}: different kind");
        assert_eq!(port.body, legacy.body, "event {index}: different body");
    }
    assert!(actual.windows(2).all(|pair| pair[0].seq < pair[1].seq));
}
