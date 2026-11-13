//! The Agent registry, the Provider store, and one real worker process started
//! from the supervisor, ported from
//! `packages/runtime-legacy/src/supervisor/{agents,providers,workers}`.

mod support;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::json;
use support::worker_binary;
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse, ToWorker};
use veeloe_runtime_supervisor::agents::{agent_dir, Agent, AgentRegistry};
use veeloe_runtime_supervisor::providers::{
    load_providers, save_providers, upstream_headers, Auth, Provider,
};
use veeloe_runtime_supervisor::workers::{sandboxed, SupervisorLlm, Workers};

fn agent() -> Agent {
    Agent {
        id: "a1".into(),
        name: "Deployer".into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
    }
}

#[test]
fn an_agent_is_written_read_changed_and_removed() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    assert!(registry.all().expect("all").is_empty());

    registry.add(&agent()).expect("add");
    assert_eq!(registry.get("a1").expect("get"), Some(agent()));
    // The file is the source of truth, not the struct in memory.
    let reopened = AgentRegistry::open(home.path()).expect("registry");
    assert_eq!(reopened.all().expect("all").len(), 1);

    let mut renamed = agent();
    renamed.name = "Builder".into();
    renamed.allowlist = vec!["ls".into()];
    reopened.replace(&renamed).expect("replace");
    assert_eq!(
        reopened.get("a1").expect("get").expect("agent").name,
        "Builder"
    );

    reopened.remove("a1").expect("remove");
    assert!(reopened.all().expect("all").is_empty());
}

#[test]
fn an_agent_id_that_is_not_a_plain_folder_name_is_refused() {
    let home = tempdir().expect("home");
    assert!(agent_dir(home.path(), "../escape").is_err());
    assert!(agent_dir(home.path(), "a/b").is_err());
    let dir = agent_dir(home.path(), "a1").expect("dir");
    assert!(dir.join("workdir").is_dir());
    assert!(dir.join("tmp").is_dir());
}

#[test]
fn a_providers_key_and_the_presets_own_headers_go_upstream() {
    let home = tempdir().expect("home");
    let providers = vec![
        Provider {
            name: "main".into(),
            url: "https://api.anthropic.test".into(),
            key: "sk-the-key".into(),
            auth: Auth::ApiKey,
            preset: Some("anthropic".into()),
        },
        Provider {
            name: "go".into(),
            url: "https://opencode.test".into(),
            key: "go-key".into(),
            auth: Auth::Bearer,
            preset: Some("opencode-go".into()),
        },
    ];
    save_providers(home.path(), &providers).expect("save");
    assert_eq!(load_providers(home.path()).expect("load"), providers);

    let anthropic = upstream_headers(&providers[0], Some("t1"));
    assert_eq!(
        veeloe_runtime_core::header(&anthropic, "x-api-key"),
        Some("sk-the-key")
    );
    assert!(veeloe_runtime_core::header(&anthropic, "user-agent")
        .expect("agent")
        .starts_with("veeloe/"));

    // Go answers 400 MissingSessionID without a session that stays the same for
    // one conversation.
    let go = upstream_headers(&providers[1], Some("t1"));
    assert_eq!(
        veeloe_runtime_core::header(&go, "authorization"),
        Some("Bearer go-key")
    );
    assert_eq!(
        veeloe_runtime_core::header(&go, "x-opencode-session"),
        Some("t1")
    );
}

struct CannedLlm {
    requests: Mutex<Vec<LlmHttpRequest>>,
}

#[async_trait]
impl SupervisorLlm for CannedLlm {
    async fn answer(&self, _agent: &str, request: LlmHttpRequest) -> LlmHttpResponse {
        self.requests.lock().expect("requests").push(request);
        LlmHttpResponse {
            status: 200,
            headers: vec![("content-type".into(), "application/json".into())],
            body: json!({
                "content": [{ "type": "text", "text": "hi" }],
                "stop_reason": "end_turn",
            })
            .to_string(),
        }
    }
}

async fn until(condition: impl Fn() -> bool, millis: u64) -> bool {
    let end = Instant::now() + Duration::from_millis(millis);
    while Instant::now() < end {
        if condition() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    condition()
}

#[tokio::test]
async fn an_agent_is_created_and_its_worker_is_ready_and_runs_a_task() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent()).expect("add");

    let llm = Arc::new(CannedLlm {
        requests: Mutex::new(Vec::new()),
    });
    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);

    let workers = Workers::new(
        home.path().to_path_buf(),
        worker_binary(),
        Arc::clone(&llm) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        // This test is about the IPC, not the sandbox: task 4.4c runs it under one.
        Arc::new(|_agent, command| command),
    );

    let agent = registry.get("a1").expect("get").expect("agent");
    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the worker never said ready: {:?}",
        lines.lock().expect("lines")
    );

    // A message sent now goes over the worker's own IPC.
    assert!(workers.send(
        "a1",
        ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        }
    ));

    let ended =
        |kind: &str| {
            heard.lock().expect("heard").iter().any(
                |message| matches!(message, FromWorker::Event { event, .. } if event.kind == kind),
            )
        };
    assert!(
        until(|| ended("turn.ended"), 10_000).await,
        "the Task never ended: {:?}",
        heard.lock().expect("heard")
    );
    let events = heard.lock().expect("heard").clone();
    let kinds: Vec<String> = events
        .iter()
        .filter_map(|message| match message {
            FromWorker::Event { event, .. } if event.kind != "context.usage" => {
                Some(event.kind.clone())
            }
            FromWorker::Event { .. } => None,
            _ => None,
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "turn.ended"
        ]
    );
    assert_eq!(
        events
            .iter()
            .find_map(|message| match message {
                FromWorker::Event { event, .. } if event.kind == "turn.ended" =>
                    Some(event.body["reason"].clone()),
                _ => None,
            })
            .expect("ended"),
        json!("done")
    );

    // The request reached the supervisor, and it never carried a Provider key.
    let requests = llm.requests.lock().expect("requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(
        veeloe_runtime_core::header(&requests[0].headers, "x-veeloe-task"),
        Some("t1")
    );
    assert_eq!(
        veeloe_runtime_core::header(&requests[0].headers, "x-api-key"),
        None
    );

    workers.stop_all();
}

/// Answers the first request with tool calls that try to leave the Agent's
/// folder, and the second with the end of the Turn.
struct ScriptedLlm {
    secret: String,
    link: String,
    requests: Mutex<usize>,
}

#[async_trait]
impl SupervisorLlm for ScriptedLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        let first = {
            let mut seen = self.requests.lock().expect("requests");
            *seen += 1;
            *seen == 1
        };
        let body = if first {
            let bash = |id: &str, command: String| {
                json!({ "type": "tool_use", "id": id, "name": "bash", "input": { "command": command } })
            };
            json!({
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [
                    bash("t-secret", format!("cat {}", self.secret)),
                    bash("t-home", "echo $HOME".into()),
                    bash("t-write", "touch made.txt".into()),
                    { "type": "tool_use", "id": "t-link", "name": "read", "input": { "path": self.link } },
                ],
                "stop_reason": "tool_use",
            })
        } else {
            json!({
                "id": "msg_2",
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "text", "text": "done" }],
                "stop_reason": "end_turn",
            })
        };
        LlmHttpResponse {
            status: 200,
            headers: vec![("content-type".into(), "application/json".into())],
            body: body.to_string(),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn a_sandboxed_worker_runs_a_turn_and_its_tools_stay_in_the_agents_folder() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["cat".into(), "echo".into(), "touch".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    // Something of the owner's, outside the Agent's folder and the Runtime's.
    let owner = tempdir().expect("owner");
    let secret = std::fs::canonicalize(owner.path())
        .expect("real owner")
        .join("secret.txt");
    std::fs::write(&secret, "TOPSECRET").expect("secret");
    let dir = agent_dir(&home_path, "a1").expect("dir");
    std::os::unix::fs::symlink(&secret, dir.join("workdir/link")).expect("symlink");

    let llm = Arc::new(ScriptedLlm {
        secret: secret.to_string_lossy().to_string(),
        link: "link".into(),
        requests: Mutex::new(0),
    });
    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::clone(&llm) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        // No proxy listens here: this Turn needs no network.
        sandboxed(home_path.clone(), "http://127.0.0.1:9".into()),
    );

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the sandboxed worker never said ready: {:?}",
        lines.lock().expect("lines")
    );
    assert!(workers.send(
        "a1",
        ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        }
    ));
    let ended = || {
        heard.lock().expect("heard").iter().any(
            |message| matches!(message, FromWorker::Event { event, .. } if event.kind == "turn.ended"),
        )
    };
    assert!(
        until(ended, 20_000).await,
        "the Turn never ended: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    workers.stop_all();

    let results: Vec<(String, String)> = heard
        .lock()
        .expect("heard")
        .iter()
        .filter_map(|message| match message {
            FromWorker::Event { event, .. } if event.kind == "tool.result" => {
                Some(event.body["content"].as_array().cloned().unwrap_or_default())
            }
            _ => None,
        })
        .flatten()
        .map(|block| {
            (
                block["tool_use_id"].as_str().unwrap_or_default().to_string(),
                block["content"].to_string(),
            )
        })
        .collect();
    let result = |id: &str| {
        results
            .iter()
            .find(|(seen, _)| seen == id)
            .map(|(_, content)| content.clone())
            .unwrap_or_else(|| panic!("no result for {id}: {results:?}"))
    };
    // Neither the command nor the read tool got the owner's file.
    assert!(!result("t-secret").contains("TOPSECRET"), "{results:?}");
    assert!(!result("t-link").contains("TOPSECRET"), "{results:?}");
    // The command's home is the Agent's own, and its Workdir is writable.
    assert!(
        result("t-home").contains(&format!("{}", dir.join(".home").display())),
        "{results:?}"
    );
    assert!(dir.join("workdir/made.txt").is_file(), "{results:?}");
    assert!(dir.join(".home/.gitconfig").is_file());
}

/// What one Turn's tools answered: `(tool_use id, content, is_error)`.
fn tool_results(heard: &Arc<Mutex<Vec<FromWorker>>>) -> Vec<(String, String, bool)> {
    heard
        .lock()
        .expect("heard")
        .iter()
        .filter_map(|message| match message {
            FromWorker::Event { event, .. } if event.kind == "tool.result" => {
                Some(event.body["content"].as_array().cloned().unwrap_or_default())
            }
            _ => None,
        })
        .flatten()
        .map(|block| {
            (
                block["tool_use_id"].as_str().unwrap_or_default().to_string(),
                block["content"].to_string(),
                block["is_error"].as_bool().unwrap_or(false),
            )
        })
        .collect()
}

/// Answers the first request with a command and the file tools aimed at the
/// Task log, and the second with the end of the Turn.
struct TrespassLlm {
    log: String,
    requests: Mutex<usize>,
}

#[async_trait]
impl SupervisorLlm for TrespassLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        let first = {
            let mut seen = self.requests.lock().expect("requests");
            *seen += 1;
            *seen == 1
        };
        let body = if first {
            json!({
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [
                    { "type": "tool_use", "id": "t-bash", "name": "bash", "input": { "command": format!("cp /etc/hosts {}", self.log) } },
                    { "type": "tool_use", "id": "t-write", "name": "write", "input": { "path": self.log, "content": "hacked" } },
                    { "type": "tool_use", "id": "t-memory", "name": "memory", "input": { "text": "hacked" } },
                ],
                "stop_reason": "tool_use",
            })
        } else {
            json!({
                "id": "msg_2",
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "text", "text": "done" }],
                "stop_reason": "end_turn",
            })
        };
        LlmHttpResponse {
            status: 200,
            headers: vec![("content-type".into(), "application/json".into())],
            body: body.to_string(),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn a_command_and_the_file_tools_cannot_reach_the_task_log() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["cp".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let log = veeloe_runtime_supervisor::task_log::path(&home_path, "a1");
    let dir = agent_dir(&home_path, "a1").expect("dir");
    // The memory tool names only MEMORY.md, so a link there is the one way it
    // could be aimed at the log.
    std::os::unix::fs::symlink(&log, dir.join("workdir/MEMORY.md")).expect("symlink");

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(TrespassLlm {
            log: log.to_string_lossy().to_string(),
            requests: Mutex::new(0),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        sandboxed(home_path.clone(), "http://127.0.0.1:9".into()),
    );

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the sandboxed worker never said ready: {:?}",
        lines.lock().expect("lines")
    );
    assert!(workers.send(
        "a1",
        ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        }
    ));
    let ended = || {
        heard.lock().expect("heard").iter().any(
            |message| matches!(message, FromWorker::Event { event, .. } if event.kind == "turn.ended"),
        )
    };
    assert!(
        until(ended, 20_000).await,
        "the Turn never ended: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    workers.stop_all();

    // Every way of writing the file the tools have was refused, with the
    // refusal the model saw, before anything reached the log.
    let results = tool_results(&heard);
    for id in ["t-bash", "t-write", "t-memory"] {
        let (_, content, is_error) = results
            .iter()
            .find(|(seen, _, _)| seen == id)
            .unwrap_or_else(|| panic!("no result for {id}: {results:?}"));
        assert!(is_error, "{id} was allowed: {content}");
    }
    let log_events = veeloe_runtime_core::EventStore::open(&log)
        .expect("the supervisor's log")
        .events("t1", 0)
        .expect("events");
    // The file the command and the tools aimed at is still the log: one Task,
    // and the Turn that ran after the attempts is in it.
    let kinds: Vec<&str> = log_events
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
        ],
        "{log_events:?}"
    );
}

/// Answers at once with a long command, so the Turn is running when the worker
/// is stopped.
struct SlowLlm;

#[async_trait]
impl SupervisorLlm for SlowLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        LlmHttpResponse {
            status: 200,
            headers: Vec::new(),
            body: json!({
                "content": [{ "type": "tool_use", "id": "t-slow", "name": "bash", "input": { "command": "sleep 5" } }],
                "stop_reason": "tool_use",
            })
            .to_string(),
        }
    }
}

#[tokio::test]
async fn the_events_of_a_running_turn_outlive_the_worker_that_ran_it() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["sleep".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(SlowLlm) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(|_line| {}),
        // This Turn needs no sandbox: what is checked is the log's owner.
        Arc::new(|_agent, command| command),
    );

    workers.start(&agent);
    assert!(until(|| workers.is_ready("a1"), 10_000).await);
    assert!(workers.send(
        "a1",
        ToWorker::Message {
            task: "t1".into(),
            id: "m-go".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig-go".into(),
        }
    ));
    let running = || {
        heard.lock().expect("heard").iter().any(
            |message| matches!(message, FromWorker::Event { event, .. } if event.kind == "llm.message"),
        )
    };
    assert!(until(running, 10_000).await, "the Turn never started");

    // The worker dies in the middle of its Turn, as a crash would.
    workers.stop("a1");
    let log = veeloe_runtime_supervisor::task_log::path(&home_path, "a1");
    let before = veeloe_runtime_core::EventStore::open(&log)
        .expect("the supervisor's log")
        .events("t1", 0)
        .expect("events");
    let kinds: Vec<&str> = before.iter().map(|event| event.kind.as_str()).collect();
    assert!(kinds.contains(&"member.message"), "{kinds:?}");
    assert!(kinds.contains(&"turn.started"), "{kinds:?}");
    assert!(kinds.contains(&"llm.message"), "{kinds:?}");
    assert!(!kinds.contains(&"turn.ended"), "the Turn had not ended: {kinds:?}");

    // A new worker reads that history and closes the Turn it finds open.
    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the second worker never started"
    );
    let after = veeloe_runtime_core::EventStore::open(&log)
        .expect("the supervisor's log")
        .events("t1", 0)
        .expect("events");
    let kinds: Vec<&str> = after.iter().map(|event| event.kind.as_str()).collect();
    assert!(kinds.contains(&"turn.interrupted"), "{kinds:?}");
    let ended = after
        .iter()
        .find(|event| event.kind == "turn.ended")
        .expect("a closed Turn");
    assert_eq!(ended.body["reason"], json!("interrupted"));
    workers.stop_all();
}

#[tokio::test]
async fn an_existing_log_keeps_its_history_after_the_move() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let agent = agent();
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    // An Agent from before the update: its log is in its writable folder.
    agent_dir(&home_path, "a1").expect("agent folder");
    let old = home_path.join("agents/a1/tasks.db");
    {
        let mut store = veeloe_runtime_core::EventStore::open(&old).expect("old log");
        store.create_task("t-old", "m_owner").expect("task");
        store
            .append(
                "t-old",
                "member.message",
                &json!({ "member": "m_owner", "id": "m-old", "text": "yesterday" }),
                Some("m-old"),
            )
            .expect("event");
    }

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(CannedLlm {
            requests: Mutex::new(Vec::new()),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(|_line| {}),
        Arc::new(|_agent, command| command),
    );

    workers.start(&agent);
    assert!(until(|| workers.is_ready("a1"), 10_000).await);
    assert!(workers.send(
        "a1",
        ToWorker::List {
            member: "m_owner".into(),
        }
    ));
    let listed = || {
        heard.lock().expect("heard").iter().any(|message| {
            matches!(message, FromWorker::Tasks { tasks, .. } if tasks.iter().any(|task| task.id == "t-old"))
        })
    };
    assert!(
        until(listed, 10_000).await,
        "the old Task is gone: {:?}",
        heard.lock().expect("heard")
    );
    workers.stop_all();

    // Nothing the Owner had to do: the file moved, and only the log moved.
    assert!(!old.exists(), "the old log is still in the writable folder");
    assert!(veeloe_runtime_supervisor::task_log::path(&home_path, "a1").is_file());
}
