//! The Agent registry, the Provider store, and one real worker process started
//! from the supervisor, ported from
//! `packages/runtime-legacy/src/supervisor/{agents,providers,workers}`.

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::json;
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse, ToWorker};
use veeloe_runtime_supervisor::agents::{agent_dir, Agent, AgentRegistry};
use veeloe_runtime_supervisor::providers::{
    load_providers, save_providers, upstream_headers, Auth, Provider,
};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

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

fn worker_binary() -> Vec<String> {
    // The test binary sits in `target/debug/deps`, so the worker is one folder up.
    let beside = std::env::current_exe()
        .expect("current exe")
        .parent()
        .and_then(|deps| deps.parent())
        .map(|debug| debug.join("veeloe"));
    if let Some(path) = beside.as_ref() {
        if path.is_file() {
            return vec![path.to_string_lossy().to_string(), "worker".to_string()];
        }
    }
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let status = Command::new(cargo)
        .args(["build", "-p", "veeloe-runtime-supervisor", "--bin", "veeloe"])
        .status()
        .expect("build the worker");
    assert!(status.success(), "could not build veeloe");
    vec![
        beside.expect("a target folder").to_string_lossy().to_string(),
        "worker".to_string(),
    ]
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

    let ended = |kind: &str| {
        heard.lock().expect("heard").iter().any(|message| {
            matches!(message, FromWorker::Event { event, .. } if event.kind == kind)
        })
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
            FromWorker::Event { event, .. } => Some(event.kind.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        kinds,
        vec!["member.message", "turn.started", "llm.message", "turn.ended"]
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
