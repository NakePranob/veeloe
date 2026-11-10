//! `agent.create`, `agent.update` and `agent.list`: what a Controller sees of the
//! Agents on this Machine, and never a Provider's key.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::AgentRegistry;
use veeloe_runtime_supervisor::llm::{HttpAnswer, HttpClient};
use veeloe_runtime_supervisor::providers::{Auth, Provider};
use veeloe_runtime_supervisor::tasks::{agents_listed, dispatch, Inbound, Machine, Outbox};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

/// The one Provider on this test Machine, and what it lists.
struct Models;

#[async_trait::async_trait]
impl HttpClient for Models {
    async fn get(&self, url: &str, _headers: Vec<(String, String)>) -> Result<HttpAnswer, String> {
        if !url.starts_with("https://main.test/v1/models") {
            return Ok(HttpAnswer {
                status: 404,
                headers: Vec::new(),
                body: String::new(),
            });
        }
        Ok(HttpAnswer {
            status: 200,
            headers: Vec::new(),
            body: json!({
                "data": [{ "id": "model-a", "display_name": "Model A" }],
                "has_more": false,
            })
            .to_string(),
        })
    }

    async fn post(
        &self,
        _url: &str,
        _headers: Vec<(String, String)>,
        _body: String,
    ) -> Result<HttpAnswer, String> {
        Err("not used".into())
    }
}

fn providers() -> Vec<Provider> {
    vec![Provider {
        name: "main".into(),
        url: "https://main.test".into(),
        key: "provider-key-must-not-leave".into(),
        auth: Auth::ApiKey,
        preset: None,
    }]
}

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

#[derive(Default)]
struct Recording {
    sent: Mutex<Vec<(String, String, Value)>>,
}

impl Outbox for Recording {
    fn to_member(&self, member: &str, type_: &str, body: Value, _task: Option<&str>) {
        self.sent
            .lock()
            .expect("sent")
            .push((member.to_string(), type_.to_string(), body));
    }
}

impl Recording {
    fn last(&self) -> (String, Value) {
        let sent = self.sent.lock().expect("sent");
        let (_, type_, body) = sent.last().expect("a reply");
        (type_.clone(), body.clone())
    }
}

fn from() -> Inbound {
    Inbound {
        member: "member-1".into(),
        reference: "sig".into(),
        task: None,
    }
}

#[tokio::test]
async fn an_agent_is_created_listed_and_updated_and_no_provider_key_is_ever_sent() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    let workers = Workers::new(
        home.path().to_path_buf(),
        vec!["/bin/true".into()],
        Arc::new(Silent) as Arc<dyn SupervisorLlm>,
        Arc::new(|_agent: &str, _message: FromWorker| {}),
        Arc::new(|_line: &str| {}),
        Arc::new(|_agent, command| command),
    );
    let outbox = Recording::default();
    let providers = providers();
    let http = Models;
    let machine = Machine {
        registry: &registry,
        workers: &workers,
        routes: None,
        providers: &providers,
        egress: &[],
        budgets: None,
        http: &http,
    };

    dispatch(
        &machine,
        &outbox,
        &from(),
        "agent.create",
        &json!({
            "id": "a1",
            "name": "Deployer",
            "provider": "main",
            "model": "model-a",
            "allowlist": ["ls"],
        }),
    )
    .await;
    let (type_, body) = outbox.last();
    assert_eq!(type_, "agent.listed");
    assert_eq!(body["agents"][0]["id"], "a1");
    assert_eq!(body["agents"][0]["name"], "Deployer");
    assert_eq!(body["agents"][0]["allowlist"], json!(["ls"]));
    assert_eq!(body["agents"][0]["approvalTimeoutS"], 3_600);
    assert_eq!(
        body["providers"],
        json!([{ "name": "main", "models": [{ "id": "model-a", "name": "Model A" }] }])
    );
    assert!(!body.to_string().contains("key"), "{body}");

    // Creating the same id again is refused rather than silently replaced.
    dispatch(&machine, &outbox, &from(), "agent.create", &json!({ "id": "a1" })).await;
    {
        let sent = outbox.sent.lock().expect("sent");
        assert_eq!(sent.last().expect("reply").1, "error");
        assert_eq!(sent.last().expect("reply").2["code"], "agent.exists");
    }

    dispatch(
        &machine,
        &outbox,
        &from(),
        "agent.update",
        &json!({ "id": "a1", "name": "Builder" }),
    )
    .await;
    let (type_, body) = outbox.last();
    assert_eq!(type_, "agent.listed");
    assert_eq!(body["agents"][0]["name"], "Builder");
    // What was not sent stays as it was.
    assert_eq!(body["agents"][0]["model"], "model-a");
    assert_eq!(body["agents"][0]["allowlist"], json!(["ls"]));

    dispatch(&machine, &outbox, &from(), "agent.list", &json!({})).await;
    assert_eq!(outbox.last().0, "agent.listed");
    assert_eq!(
        agents_listed(&registry, &[], &["api.anthropic.com".into()])["egress"],
        json!(["api.anthropic.com"])
    );

    workers.stop_all();
}

#[tokio::test]
async fn an_agent_can_be_deleted_while_its_workdir_stays() {
    use veeloe_runtime_supervisor::agents::{agent_dir, Agent};

    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    let workers = Workers::new(
        home.path().to_path_buf(),
        vec!["/bin/true".into()],
        Arc::new(Silent) as Arc<dyn SupervisorLlm>,
        Arc::new(|_agent: &str, _message: FromWorker| {}),
        Arc::new(|_line: &str| {}),
        Arc::new(|_agent, command| command),
    );
    let agent = Agent {
        id: "a1".into(),
        name: "Deployer".into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
    };
    registry.add(&agent).expect("add");
    let dir = agent_dir(home.path(), "a1").expect("workdir");
    let outbox = Recording::default();
    let providers = providers();
    let http = Models;
    let machine = Machine {
        registry: &registry,
        workers: &workers,
        routes: None,
        providers: &providers,
        egress: &[],
        budgets: None,
        http: &http,
    };
    dispatch(&machine, &outbox, &from(), "agent.delete", &json!({ "id": "a1" })).await;
    assert!(registry.get("a1").expect("registry").is_none());
    assert!(dir.exists());
    let (type_, body) = outbox.last();
    assert_eq!(type_, "agent.listed");
    assert_eq!(body["agents"], json!([]));
}
