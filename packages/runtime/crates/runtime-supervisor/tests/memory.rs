//! `memory.get`: the read-only answer behind the Controller's Memory page
//! (`agent-memory-page`). The text must be the same one the prompt gets.

use std::fs;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::{Agent, AgentRegistry};
use veeloe_runtime_supervisor::llm::{HttpAnswer, HttpClient};
use veeloe_runtime_supervisor::tasks::{dispatch, Inbound, Machine, Outbox};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

struct Silent;

#[async_trait::async_trait]
impl SupervisorLlm for Silent {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        LlmHttpResponse {
            status: 500,
            headers: Vec::new(),
            body: String::new(),
        }
    }
}

struct NoProviders;

#[async_trait::async_trait]
impl HttpClient for NoProviders {
    async fn get(&self, _url: &str, _headers: Vec<(String, String)>) -> Result<HttpAnswer, String> {
        Err("no provider".into())
    }

    async fn post(
        &self,
        _url: &str,
        _headers: Vec<(String, String)>,
        _body: String,
    ) -> Result<HttpAnswer, String> {
        Err("no provider".into())
    }
}

#[derive(Default)]
struct Recording {
    sent: Mutex<Vec<(String, Value)>>,
}

impl Outbox for Recording {
    fn to_member(&self, _member: &str, type_: &str, body: Value, _task: Option<&str>) {
        self.sent
            .lock()
            .expect("sent")
            .push((type_.to_string(), body));
    }
}

impl Recording {
    fn last(&self) -> (String, Value) {
        let sent = self.sent.lock().expect("sent");
        let (type_, body) = sent.last().expect("a reply");
        (type_.clone(), body.clone())
    }
}

fn from() -> Inbound {
    Inbound {
        member: "member-1".into(),
        key: None,
        reference: "sig".into(),
        task: None,
    }
}

fn agent(id: &str) -> Agent {
    Agent {
        id: id.into(),
        name: "Pang".into(),
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

fn machine<'a>(
    registry: &'a AgentRegistry,
    workers: &'a Workers,
    http: &'a dyn HttpClient,
) -> Machine<'a> {
    Machine {
        registry,
        workers,
        routes: None,
        secret_key: None,
        uploads: None,
        push_tokens: None,
        providers: &[],
        egress: None,
        trust: None,
        proxies: None,
        approvals: None,
        budgets: None,
        http,
    }
}

fn workers(home: &std::path::Path) -> Workers {
    Workers::new(
        home.to_path_buf(),
        vec!["/bin/true".into()],
        Arc::new(Silent) as Arc<dyn SupervisorLlm>,
        Arc::new(|_agent: &str, _message: FromWorker| {}),
        Arc::new(|_line: &str| {}),
        Arc::new(|_agent, command| command),
    )
}

#[tokio::test]
async fn memory_get_answers_with_the_prompt_text_and_the_whole_file_count() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("agent");
    let workdir = home.path().join("agents/a1/workdir");
    fs::create_dir_all(&workdir).expect("workdir");
    let text = "จดไว้ว่าเจ้าของชอบชา\n";
    fs::write(workdir.join("MEMORY.md"), text).expect("memory");

    let workers = workers(home.path());
    let http = NoProviders;
    let machine = machine(&registry, &workers, &http);
    let outbox = Recording::default();

    dispatch(
        &machine,
        &outbox,
        &from(),
        "memory.get",
        &json!({ "request": "req-1", "agent": "a1" }),
    )
    .await;

    let (type_, body) = outbox.last();
    assert_eq!(type_, "memory.got");
    assert_eq!(body["request"], "req-1");
    assert_eq!(body["agent"], "a1");
    assert_eq!(body["exists"], true);
    assert_eq!(body["chars"], text.chars().count());
    assert_eq!(body["text"], text);
}

#[tokio::test]
async fn a_memory_over_the_cap_arrives_capped_with_the_whole_count() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("agent");
    let workdir = home.path().join("agents/a1/workdir");
    fs::create_dir_all(&workdir).expect("workdir");
    let text = "a".repeat(veeloe_runtime_core::memory::MEMORY_LIMIT + 10);
    fs::write(workdir.join("MEMORY.md"), &text).expect("memory");

    let workers = workers(home.path());
    let http = NoProviders;
    let machine = machine(&registry, &workers, &http);
    let outbox = Recording::default();

    dispatch(
        &machine,
        &outbox,
        &from(),
        "memory.get",
        &json!({ "request": "req-2", "agent": "a1" }),
    )
    .await;

    let (_, body) = outbox.last();
    assert_eq!(body["chars"], text.chars().count());
    let sent = body["text"].as_str().expect("text");
    assert!(sent.starts_with(&"a".repeat(veeloe_runtime_core::memory::MEMORY_LIMIT)));
    assert!(sent.ends_with("Keep only what every Task needs.)"));
}

#[tokio::test]
async fn no_file_answers_with_no_text_and_creates_nothing() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("agent");
    let workers = workers(home.path());
    let http = NoProviders;
    let machine = machine(&registry, &workers, &http);
    let outbox = Recording::default();

    dispatch(
        &machine,
        &outbox,
        &from(),
        "memory.get",
        &json!({ "request": "req-3", "agent": "a1" }),
    )
    .await;

    let (type_, body) = outbox.last();
    assert_eq!(type_, "memory.got");
    assert_eq!(body["exists"], false);
    assert_eq!(body["chars"], 0);
    assert_eq!(body["text"], "");
    assert!(
        !home.path().join("agents").exists(),
        "reading must not create the Agent's folder"
    );
}

#[tokio::test]
async fn an_unknown_agent_is_refused() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    let workers = workers(home.path());
    let http = NoProviders;
    let machine = machine(&registry, &workers, &http);
    let outbox = Recording::default();

    dispatch(
        &machine,
        &outbox,
        &from(),
        "memory.get",
        &json!({ "request": "req-4", "agent": "nobody" }),
    )
    .await;

    let (type_, body) = outbox.last();
    assert_eq!(type_, "error");
    assert_eq!(body["code"], "agent.unknown");
}

#[tokio::test]
async fn a_trashed_agent_can_still_be_read() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    let mut trashed = agent("a1");
    trashed.deleted_at = Some(1_700_000_000_000);
    registry.add(&trashed).expect("agent");
    let workdir = home.path().join("agents/a1/workdir");
    fs::create_dir_all(&workdir).expect("workdir");
    fs::write(workdir.join("MEMORY.md"), "owner likes tea").expect("memory");

    let workers = workers(home.path());
    let http = NoProviders;
    let machine = machine(&registry, &workers, &http);
    let outbox = Recording::default();

    dispatch(
        &machine,
        &outbox,
        &from(),
        "memory.get",
        &json!({ "request": "req-5", "agent": "a1" }),
    )
    .await;

    let (type_, body) = outbox.last();
    assert_eq!(type_, "memory.got");
    assert_eq!(body["text"], "owner likes tea");
}
