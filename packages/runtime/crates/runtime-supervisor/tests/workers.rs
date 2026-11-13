//! The Agent registry, the Provider store, and one real worker process started
//! from the supervisor, ported from
//! `packages/runtime-legacy/src/supervisor/{agents,providers,workers}`.

mod support;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::json;
use support::worker_binary;
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse, ToWorker};
use veeloe_runtime_supervisor::agents::{agent_dir, Agent, AgentRegistry};
use veeloe_runtime_supervisor::limits::Limits;
use veeloe_runtime_supervisor::logs;
use veeloe_runtime_supervisor::providers::{
    load_providers, save_providers, upstream_headers, Auth, Provider,
};
use veeloe_runtime_supervisor::toolchain::{Outcome, Report};
use veeloe_runtime_supervisor::workers::{sandboxed, SupervisorLlm, Workers};

/// The wrap the supervisor uses, with this Agent's own proxy running. No test
/// here reaches the network, but the listener and the Linux socket have to be
/// there before the worker says ready (ADR 0069, issue #43).
async fn sandboxed_for(home: &std::path::Path) -> veeloe_runtime_supervisor::workers::Wrap {
    let egress =
        Arc::new(veeloe_runtime_supervisor::egress::Egress::open(home).expect("egress"));
    let proxies = Arc::new(veeloe_runtime_supervisor::proxy::Proxies::new(
        home.to_path_buf(),
        egress,
    ));
    proxies.ensure("a1").await.expect("the Agent's proxy");
    sandboxed(home.to_path_buf(), proxies)
}

fn agent() -> Agent {
    Agent {
        id: "a1".into(),
        name: "Deployer".into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        egress: Vec::new(),
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
        // The Agent's proxy listens; this Turn just never reaches the network.
        sandboxed_for(&home_path).await,
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

/// Issue #37: the profile names one service at a time, and a real Turn still
/// runs the toolchains a Task cannot be done without. The check is behaviour:
/// `git` and `bun` answer inside the narrowed sandbox, not what the profile
/// says (ADR 0022).
#[cfg(target_os = "macos")]
#[tokio::test]
async fn a_sandboxed_worker_runs_a_turn_with_git_and_bun() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["git".into(), "bun".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let llm = Arc::new(ToolchainLlm {
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
        // No proxy listens here: neither `git` nor `bun` reaches the network.
        sandboxed_for(&home_path).await,
    );

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the worker under the narrowed service list never said ready: {:?}",
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
        until(ended, 30_000).await,
        "the Turn with git and bun never ended: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    workers.stop_all();

    let results: Vec<(String, serde_json::Value)> = heard
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
                block.clone(),
            )
        })
        .collect();
    let result = |id: &str| {
        results
            .iter()
            .find(|(seen, _)| seen == id)
            .map(|(_, block)| block.clone())
            .unwrap_or_else(|| panic!("no result for {id}: {results:?}"))
    };
    // Each command ran and said its version: no refusal, no missing library.
    for (id, expected) in [
        ("t-git", "git version"),
        ("t-bun-run", "bun-ok"),
    ] {
        let block = result(id);
        assert!(
            block.get("is_error").is_none(),
            "`{id}` failed under the narrowed service list: {block}"
        );
        let content = block["content"].as_str().unwrap_or_default();
        assert!(content.contains(expected), "`{id}` answered without `{expected}`: {block}");
        assert!(content.contains("exit code: 0"), "`{id}` did not exit cleanly: {block}");
    }
    // `bun --version` answers with the version alone, which is what a version
    // check looks like when it works.
    let bun = result("t-bun");
    assert!(
        bun.get("is_error").is_none(),
        "`bun --version` failed under the narrowed service list: {bun}"
    );
    let text = bun["content"].as_str().unwrap_or_default();
    let version = text.lines().next().unwrap_or_default();
    assert!(
        version.chars().next().is_some_and(|first| first.is_ascii_digit())
            && version.contains('.')
            && text.contains("exit code: 0"),
        "`bun --version` answered without a version: {bun}"
    );
}

/// Answers the first request with the toolchains a Task needs and the second
/// with the end of the Turn.
struct ToolchainLlm {
    requests: Mutex<usize>,
}

/// Issue #42: the worker knows the Agent's port range, and a command it runs
/// sees it and can serve on it. The check is the command's own output, not the
/// environment the supervisor meant to set (ADR 0022).
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn a_command_sees_the_agents_ports_and_can_serve_on_them() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["printf".into(), "python3".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");
    // The range the supervisor would have reserved, written down before the
    // worker opens: a free one, so this test binds a real port.
    let start = free_range();
    std::fs::create_dir_all(home_path.join("runtime")).expect("runtime");
    std::fs::write(
        home_path.join("runtime/ports.json"),
        format!(r#"{{"a1":{start}}}"#),
    )
    .expect("ports.json");
    let listed = (start..start + 10)
        .map(|port| port.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(PortsLlm {
            requests: Mutex::new(0),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        // Nothing listens on the proxy's port here: the range is its own.
        sandboxed_for(&home_path).await,
    );

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the sandboxed worker never said ready: {:?}",
        lines.lock().expect("lines")
    );
    let say = |id: &str| {
        assert!(workers.send(
            "a1",
            ToWorker::Message {
                task: id.into(),
                id: format!("m-{id}"),
                member: "m_owner".into(),
                text: "go".into(),
                reference: format!("sig-{id}"),
            }
        ));
    };
    let answered = |tool: &str| {
        tool_results(&heard)
            .iter()
            .any(|(seen, _, _)| seen == tool)
    };

    say("t1");
    assert!(
        until(|| answered("t-ports-1"), 20_000).await,
        "the Turn never ran the command: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    // Let the Turn end before the worker is stopped. Every odd request is the
    // command, and a Turn cut in half leaves the next worker a text answer
    // where the second command is expected.
    assert!(
        until(|| task_ended(&heard, "t1"), 20_000).await,
        "the first Turn never ended: {:?}",
        heard.lock().expect("heard")
    );
    workers.stop_all();
    let first = content_of(&heard, "t-ports-1");
    assert!(!first.1, "the command was refused: {}", first.0);
    assert!(first.0.contains(&format!("port={start}")), "{}", first.0);
    assert!(first.0.contains(&format!("ports={listed}")), "{}", first.0);
    // The profile the worker runs under allows the port, so the command bound
    // it and reached it.
    assert!(first.0.contains("reachable"), "{}", first.0);
    assert!(first.0.contains("exit code: 0"), "{}", first.0);

    // The same Agent again, as after a restart: the range it was given is the
    // one it comes back with, so a service it started keeps its address.
    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the second worker never said ready: {:?}",
        lines.lock().expect("lines")
    );
    say("t2");
    assert!(
        until(|| answered("t-ports-3"), 20_000).await,
        "the second Turn never ran the command: {:?}",
        heard.lock().expect("heard")
    );
    workers.stop_all();
    let again = content_of(&heard, "t-ports-3");
    assert!(!again.1, "the command was refused: {}", again.0);
    assert!(again.0.contains(&format!("port={start}")), "{}", again.0);
    assert!(again.0.contains(&format!("ports={listed}")), "{}", again.0);
}

/// The content of one tool result, and whether the tool was refused.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn content_of(heard: &Arc<Mutex<Vec<FromWorker>>>, id: &str) -> (String, bool) {
    let results = tool_results(heard);
    let (_, content, is_error) = results
        .iter()
        .find(|(seen, _, _)| seen == id)
        .unwrap_or_else(|| panic!("no result for {id}: {results:?}"));
    (content.clone(), *is_error)
}

/// Ten loopback ports nothing on this Machine is listening on.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn free_range() -> u16 {
    for start in (20000u16..=59990).step_by(10) {
        let listening: Option<Vec<std::net::TcpListener>> = (start..start + 10)
            .map(|port| std::net::TcpListener::bind(("127.0.0.1", port)).ok())
            .collect();
        if listening.is_some() {
            return start;
        }
    }
    panic!("no free range of ten loopback ports");
}

/// Asks for the Agent's ports on every odd request and ends the Turn on every
/// even one, so each worker gets one Turn that runs a command.
struct PortsLlm {
    requests: Mutex<usize>,
}

#[async_trait]
impl SupervisorLlm for PortsLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        let seen = {
            let mut seen = self.requests.lock().expect("requests");
            *seen += 1;
            *seen
        };
        let body = if seen % 2 == 1 {
            json!({
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": format!("t-ports-{seen}"),
                    "name": "bash",
                    "input": { "command": "printf 'port=%s\\n' \"$PORT\"\nprintf 'ports=%s\\n' \"$VEELOE_PORTS\"\npython3 -c 'import os,socket;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind((\"127.0.0.1\",int(os.environ[\"PORT\"])));s.listen(1);c=socket.create_connection((\"127.0.0.1\",int(os.environ[\"PORT\"])),timeout=2);print(\"reachable\")'" }
                }],
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

#[async_trait]
impl SupervisorLlm for ToolchainLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        let first = {
            let mut seen = self.requests.lock().expect("requests");
            *seen += 1;
            *seen == 1
        };
        let body = if first {
            let bash = |id: &str, command: &str| {
                json!({ "type": "tool_use", "id": id, "name": "bash", "input": { "command": command } })
            };
            json!({
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [
                    bash("t-git", "git --version"),
                    bash("t-bun", "bun --version"),
                    bash("t-bun-run", "bun -e 'console.log(\"bun-ok\")'"),
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

/// Issue #35: a Machine whose toolchain cannot run is told to the Owner when
/// the worker opens, and the worker runs a Turn anyway.
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn a_toolchain_that_cannot_run_is_reported_and_the_worker_still_turns() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let agent = agent();
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let llm = Arc::new(CannedLlm {
        requests: Mutex::new(Vec::new()),
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
        // The Agent's proxy listens; this Turn just never reaches the network.
        sandboxed_for(&home_path).await,
    );
    // What a Machine without `bun` under its rules would answer.
    workers.checking_toolchains(Arc::new(|_agent, _bin| {
        Some(vec![
            Report {
                tool: "git".into(),
                outcome: Outcome::Ok,
            },
            Report {
                tool: "bun".into(),
                outcome: Outcome::Missing,
            },
        ])
    }));

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "a missing toolchain stopped the worker: {:?}",
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
        "a missing toolchain ended the Turn: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );

    // The Runtime log holds the report: names and results, never a path.
    let report = || -> Option<String> {
        logs::recent(&home_path)
            .ok()?
            .into_iter()
            .find(|line| line.contains("toolchain.check"))
    };
    assert!(
        until(|| report().is_some(), 10_000).await,
        "no toolchain report: {:?}",
        logs::recent(&home_path)
    );
    let line = report().expect("report");
    let value: serde_json::Value = serde_json::from_str(&line).expect("json");
    assert_eq!(value["fields"]["agent"], "a1");
    assert_eq!(
        value["fields"]["tools"],
        json!({ "git": "ok", "bun": "missing" })
    );
    assert!(
        !line.contains(home_path.to_str().expect("home")),
        "the report carries the Agent's folder: {line}"
    );
    workers.stop_all();
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

/// Whether this Task's Turn ended, so a worker can be stopped without cutting
/// it in half.
fn task_ended(heard: &Arc<Mutex<Vec<FromWorker>>>, task: &str) -> bool {
    heard.lock().expect("heard").iter().any(|message| {
        matches!(message, FromWorker::Event { task: seen, event, .. }
            if seen == task && event.kind == "turn.ended")
    })
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
        sandboxed_for(&home_path).await,
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

/// Issue #47: the CPU time limit the config names reaches the worker, and every
/// command it starts inherits it. The check is what the command answers, not
/// the value the supervisor meant to set (ADR 0022).
#[cfg(target_os = "macos")]
#[tokio::test]
async fn a_workers_commands_inherit_the_cpu_limit_from_config() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["ulimit".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(OneCommandLlm {
            command: "ulimit -t".into(),
            requests: Mutex::new(0),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        Arc::new(|_agent, command| command),
    );
    workers.limiting(Limits {
        cpu_seconds: 1_234,
        memory_mb: 4_096,
        ..Limits::default()
    });

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the worker never said ready: {:?}",
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
    assert!(
        until(|| task_ended(&heard, "t1"), 20_000).await,
        "the Turn never ended: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    workers.stop_all();

    let results = tool_results(&heard);
    let (_, content, is_error) = results
        .iter()
        .find(|(seen, _, _)| seen == "t-limit")
        .unwrap_or_else(|| panic!("no result for the command: {results:?}"));
    assert!(!is_error, "`ulimit -t` was refused: {content}");
    assert!(
        content.contains("1234"),
        "the command did not see the CPU limit from config: {content}"
    );
}

/// Answers one command, then ends the Turn.
struct OneCommandLlm {
    command: String,
    requests: Mutex<usize>,
}

#[async_trait]
impl SupervisorLlm for OneCommandLlm {
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
                "content": [{
                    "type": "tool_use",
                    "id": "t-limit",
                    "name": "bash",
                    "input": { "command": self.command },
                }],
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

/// A Turn whose command runs long enough to be cut in the middle.
struct HangingLlm;

#[async_trait]
impl SupervisorLlm for HangingLlm {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        LlmHttpResponse {
            status: 200,
            headers: Vec::new(),
            body: json!({
                "content": [{
                    "type": "tool_use",
                    "id": "t-hang",
                    "name": "bash",
                    "input": { "command": "sleep 30" },
                }],
                "stop_reason": "tool_use",
            })
            .to_string(),
        }
    }
}

/// Issue #47: a worker that stays under its memory limit keeps running, so the
/// watch does not end healthy work.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn a_worker_under_its_memory_limit_keeps_running() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let agent = agent();
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

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
    // One megabyte: a worker doing an ordinary Turn is never near 4096 MB.
    workers.reading_memory(Arc::new(|_pid| Some(1024 * 1024)));

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
    assert!(
        until(|| task_ended(&heard, "t1"), 10_000).await,
        "the Turn never ended: {:?}",
        heard.lock().expect("heard")
    );
    workers.stop_all();
    let limit = logs::recent(&home_path)
        .expect("logs")
        .into_iter()
        .find(|line| line.contains("worker.limit"));
    assert!(limit.is_none(), "a healthy worker was cut: {limit:?}");
}

/// Issue #47: over its memory limit a worker is killed, the Runtime log says
/// which Agent and which limit without any content, the worker is started
/// again, and the Turn it held ends interrupted through the usual path
/// (ADR 0033): nothing hangs.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn a_worker_over_its_memory_limit_is_killed_and_its_turn_is_interrupted() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut agent = agent();
    agent.allowlist = vec!["sleep".into()];
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent).expect("add");

    let heard: Arc<Mutex<Vec<FromWorker>>> = Arc::new(Mutex::new(Vec::new()));
    let recording = Arc::clone(&heard);
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(HangingLlm) as Arc<dyn SupervisorLlm>,
        Arc::new(move |_agent, message| {
            recording.lock().expect("heard").push(message);
        }),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        Arc::new(|_agent, command| command),
    );
    // Under the limit while the worker opens; the test lets one reading cross
    // it once the Turn is running, so the kill lands in the middle of real
    // work. The next reading is small again, as it would be once the process
    // holding the memory is gone.
    let over = Arc::new(AtomicBool::new(false));
    let watched = Arc::clone(&over);
    workers.reading_memory(Arc::new(move |_pid| {
        Some(if watched.swap(false, Ordering::SeqCst) {
            8_192 * 1024 * 1024
        } else {
            1024 * 1024
        })
    }));

    workers.start(&agent);
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the worker never said ready: {:?}",
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
    let started = || {
        heard.lock().expect("heard").iter().any(
            |message| matches!(message, FromWorker::Event { event, .. } if event.kind == "llm.message"),
        )
    };
    assert!(
        until(started, 10_000).await,
        "the Turn never started: {:?} {:?}",
        heard.lock().expect("heard"),
        lines.lock().expect("lines")
    );
    over.store(true, Ordering::SeqCst);

    let limit = || -> Option<String> {
        logs::recent(&home_path)
            .ok()?
            .into_iter()
            .find(|line| line.contains("worker.limit"))
    };
    assert!(
        until(|| limit().is_some(), 15_000).await,
        "the worker was never cut for memory: {:?} {:?}",
        logs::recent(&home_path),
        lines.lock().expect("lines")
    );
    let line = limit().expect("the limit event");
    let value: serde_json::Value = serde_json::from_str(&line).expect("json");
    assert_eq!(value["level"], "warn");
    assert_eq!(value["event"], "worker.limit");
    assert_eq!(value["fields"], json!({ "agent": "a1", "limit": "memory" }));
    assert!(
        !line.contains(home_path.to_str().expect("home")),
        "the limit event carries a path: {line}"
    );

    // The restarted worker finds the open Turn and closes it as interrupted,
    // rather than leaving the Owner waiting on a Turn nobody runs.
    let log = veeloe_runtime_supervisor::task_log::path(&home_path, "a1");
    let interrupted = || {
        veeloe_runtime_core::EventStore::open(&log)
            .and_then(|store| store.events("t1", 0))
            .map(|events| {
                // The worker writes both, one after the other, so wait for the
                // end too instead of reading between them.
                events.iter().any(|event| event.kind == "turn.interrupted")
                    && events.iter().any(|event| event.kind == "turn.ended")
            })
            .unwrap_or(false)
    };
    assert!(
        until(interrupted, 15_000).await,
        "the killed Turn was left open: {:?} {:?}",
        logs::recent(&home_path),
        lines.lock().expect("lines")
    );
    let events = veeloe_runtime_core::EventStore::open(&log)
        .expect("the supervisor's log")
        .events("t1", 0)
        .expect("events");
    let ended = events
        .iter()
        .find(|event| event.kind == "turn.ended")
        .expect("a closed Turn");
    assert_eq!(ended.body["reason"], json!("interrupted"));
    workers.stop_all();
}

/// Issue #48: a Machine with no user systemd — every container, and every Mac —
/// still opens its workers, and the Runtime log says the cgroup is not in use
/// once, not once per Agent. The answer is injected so the test says the same
/// thing on a Machine that does have systemd.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn without_a_cgroup_every_worker_runs_and_the_fallback_is_said_once() {
    let home = tempdir().expect("home");
    let home_path = std::fs::canonicalize(home.path()).expect("real home");
    let mut second = agent();
    second.id = "a2".into();
    second.name = "Builder".into();
    let registry = AgentRegistry::open(&home_path).expect("registry");
    registry.add(&agent()).expect("add");
    registry.add(&second).expect("add");

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let logging = Arc::clone(&lines);
    let workers = Workers::new(
        home_path.clone(),
        worker_binary(),
        Arc::new(CannedLlm {
            requests: Mutex::new(Vec::new()),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(|_agent, _message| {}),
        Arc::new(move |line| logging.lock().expect("lines").push(line.to_string())),
        Arc::new(|_agent, command| command),
    );
    workers.probing_cgroup(Arc::new(|| false));
    workers.start(&agent());
    assert!(
        until(|| workers.is_ready("a1"), 10_000).await,
        "the worker never said ready without a cgroup: {:?}",
        lines.lock().expect("lines")
    );
    workers.start(&second);
    assert!(
        until(|| workers.is_ready("a2"), 10_000).await,
        "the second worker never said ready without a cgroup: {:?}",
        lines.lock().expect("lines")
    );
    workers.stop_all();

    let said: Vec<serde_json::Value> = logs::recent(&home_path)
        .expect("logs")
        .iter()
        .map(|line| serde_json::from_str(line).expect("json"))
        .filter(|value: &serde_json::Value| value["event"] == "worker.cgroup_unavailable")
        .collect();
    assert_eq!(said.len(), 1, "said {said:?}");
    assert_eq!(said[0]["level"], "warn");
    assert_eq!(
        said[0]["fields"],
        json!({}),
        "the event names no Agent and no path"
    );
}
