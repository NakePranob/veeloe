//! `trigger.*` as a Controller sends them (issue #56): who may set a Trigger,
//! what the Machine keeps, and what every answer says.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::{Agent, AgentRegistry};
use veeloe_runtime_supervisor::llm::{HttpAnswer, HttpClient};
use veeloe_runtime_supervisor::tasks::{dispatch, Inbound, Machine, Outbox};
use veeloe_runtime_supervisor::triggers::Triggers;
use veeloe_runtime_supervisor::trust::{Owner, Trust};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

struct Offline;

#[async_trait::async_trait]
impl HttpClient for Offline {
    async fn get(&self, _url: &str, _headers: Vec<(String, String)>) -> Result<HttpAnswer, String> {
        Err("offline".into())
    }
    async fn post(
        &self,
        _url: &str,
        _headers: Vec<(String, String)>,
        _body: String,
    ) -> Result<HttpAnswer, String> {
        Err("offline".into())
    }
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
        self.sent
            .lock()
            .expect("sent")
            .last()
            .cloned()
            .expect("a reply")
    }
}

fn agent(id: &str) -> Agent {
    Agent {
        id: id.into(),
        name: id.into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        egress: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
        git_repos: Vec::new(),
    }
}

fn owner() -> Trust {
    Trust {
        owners: vec![Owner {
            member: "member-1".into(),
            keys: vec!["controller-1".into()],
        }],
        ..Trust::default()
    }
}

fn from(member: &str, key: &str) -> Inbound {
    Inbound {
        member: member.into(),
        key: Some(key.into()),
        reference: "sig".into(),
        task: None,
        envelope: Some(json!({ "sig": "the-signature", "type": "trigger.set" })),
    }
}

fn daily(id: &str) -> Value {
    json!({
        "agent": "a1",
        "trigger": { "id": id, "kind": "schedule", "text": "check the CI", "schedule": { "daily": { "at": "09:00" } } },
    })
}

struct Fixture {
    home: tempfile::TempDir,
    registry: AgentRegistry,
    workers: Workers,
    triggers: Triggers,
    trust: Trust,
}

impl Fixture {
    fn new() -> Self {
        let home = tempdir().expect("home");
        let registry = AgentRegistry::open(home.path()).expect("registry");
        registry.add(&agent("a1")).expect("a1");
        let workers = Workers::new(
            home.path().to_path_buf(),
            vec!["/bin/true".into()],
            Arc::new(Silent) as Arc<dyn SupervisorLlm>,
            Arc::new(|_agent: &str, _message: FromWorker| {}),
            Arc::new(|_line: &str| {}),
            Arc::new(|_agent, command| command),
        );
        let triggers = Triggers::open(home.path()).expect("triggers");
        Self {
            home,
            registry,
            workers,
            triggers,
            trust: owner(),
        }
    }

    async fn send(&self, from: &Inbound, type_: &str, body: Value) -> (String, Value) {
        let outbox = Recording::default();
        let machine = Machine {
            registry: &self.registry,
            workers: &self.workers,
            routes: None,
            secret_key: None,
            uploads: None,
            push_tokens: None,
            triggers: Some(&self.triggers),
            providers: &[],
            egress: None,
            trust: Some(&self.trust),
            proxies: None,
            approvals: None,
            budgets: None,
            http: &Offline,
        };
        dispatch(&machine, &outbox, from, type_, &body).await;
        outbox.last()
    }
}

#[tokio::test]
async fn a_schedule_is_kept_signed_and_listed_with_its_next_round() {
    let fixture = Fixture::new();
    let owner = from("member-1", "controller-1");
    let (type_, body) = fixture.send(&owner, "trigger.set", daily("tr_1")).await;
    assert_eq!(type_, "trigger.listed");
    let listed = &body["triggers"][0];
    assert_eq!(listed["id"], "tr_1");
    assert_eq!(listed["member"], "member-1");
    assert_eq!(listed["paused"], false);
    assert!(listed["nextRunAt"].as_u64().is_some());

    // On disk, outside the sandbox, with the envelope and who signed it.
    let reloaded = Triggers::open(fixture.home.path()).expect("reload");
    let held = reloaded.get("a1", "tr_1").expect("kept");
    assert_eq!(held.key, "controller-1");
    assert_eq!(held.envelope["sig"], "the-signature");
}

#[tokio::test]
async fn a_key_that_is_not_the_members_or_a_missing_agent_sets_nothing() {
    let fixture = Fixture::new();
    let stranger = from("member-1", "someone-else");
    assert_eq!(
        fixture
            .send(&stranger, "trigger.set", daily("tr_1"))
            .await
            .1["code"],
        "trigger.forbidden"
    );
    let owner = from("member-1", "controller-1");
    let mut elsewhere = daily("tr_1");
    elsewhere["agent"] = json!("nobody");
    assert_eq!(
        fixture.send(&owner, "trigger.set", elsewhere).await.1["code"],
        "agent.unknown"
    );
    assert!(fixture.triggers.all().is_empty());
}

#[tokio::test]
async fn a_trigger_is_paused_resumed_and_deleted_and_an_unknown_one_says_so() {
    let fixture = Fixture::new();
    let owner = from("member-1", "controller-1");
    fixture.send(&owner, "trigger.set", daily("tr_1")).await;
    let target = json!({ "agent": "a1", "id": "tr_1" });

    let (_, paused) = fixture.send(&owner, "trigger.pause", target.clone()).await;
    assert_eq!(paused["triggers"][0]["paused"], true);
    assert!(paused["triggers"][0].get("nextRunAt").is_none());
    let (_, resumed) = fixture.send(&owner, "trigger.resume", target.clone()).await;
    assert_eq!(resumed["triggers"][0]["paused"], false);

    let (_, deleted) = fixture.send(&owner, "trigger.delete", target.clone()).await;
    assert_eq!(deleted["triggers"], json!([]));
    assert_eq!(
        fixture.send(&owner, "trigger.run", target).await.1["code"],
        "trigger.unknown"
    );
}

#[tokio::test]
async fn running_now_needs_the_agents_worker_and_a_trigger_that_is_not_suspended() {
    let fixture = Fixture::new();
    let owner = from("member-1", "controller-1");
    fixture.send(&owner, "trigger.set", daily("tr_1")).await;
    let target = json!({ "agent": "a1", "id": "tr_1" });
    // No worker is running here: nothing is started, and the Controller is told.
    assert_eq!(
        fixture.send(&owner, "trigger.run", target.clone()).await.1["code"],
        "agent.unavailable"
    );
    fixture
        .triggers
        .suspend_keys(&["controller-1".into()])
        .expect("revoke");
    assert_eq!(
        fixture.send(&owner, "trigger.run", target.clone()).await.1["code"],
        "trigger.suspended"
    );
    let (_, listed) = fixture
        .send(&owner, "trigger.list", json!({ "agent": "a1" }))
        .await;
    assert_eq!(listed["triggers"][0]["suspended"], true);
}

#[tokio::test]
async fn a_scope_is_kept_and_an_edit_with_the_same_times_keeps_its_rounds() {
    let fixture = Fixture::new();
    let owner = from("member-1", "controller-1");
    let (_, first) = fixture.send(&owner, "trigger.set", daily("tr_1")).await;
    assert_eq!(first["triggers"][0]["allow"], json!([]));
    fixture
        .send(
            &owner,
            "trigger.pause",
            json!({ "agent": "a1", "id": "tr_1" }),
        )
        .await;
    fixture
        .triggers
        .update("a1", "tr_1", |held| held.last_run_at = Some(1_000))
        .expect("update");

    // Adding to the scope from a Task is a whole `trigger.set` again (ADR 0079).
    let mut scoped = daily("tr_1");
    scoped["trigger"]["allow"] = json!(["curl"]);
    let (type_, body) = fixture.send(&owner, "trigger.set", scoped).await;
    assert_eq!(type_, "trigger.listed");
    let listed = &body["triggers"][0];
    assert_eq!(listed["allow"], json!(["curl"]));
    assert_eq!(listed["paused"], true);
    assert_eq!(listed["lastRunAt"], 1_000);

    // New times start over.
    let mut moved = daily("tr_1");
    moved["trigger"]["schedule"] = json!({ "daily": { "at": "10:00" } });
    let (_, body) = fixture.send(&owner, "trigger.set", moved).await;
    assert_eq!(body["triggers"][0]["paused"], false);
    assert!(body["triggers"][0].get("lastRunAt").is_none());
}
