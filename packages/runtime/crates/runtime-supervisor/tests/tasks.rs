//! The Task slices through the real Hub and a real worker process: a Member's
//! message, a sync, a list and a Stop all reach the Agent's worker, and every
//! answer comes back signed.

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use support::{until, TestHub};
use tempfile::tempdir;
use tokio_tungstenite::tungstenite::Message;
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::envelope::{verify, MemorySeenSequences, Route};
use veeloe_protocol::frame::{parse_frame, Frame};
use veeloe_protocol::hub_auth::answer_challenge;
use veeloe_protocol::signer::{Outgoing, Signer};
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::{Agent, AgentRegistry};
use veeloe_runtime_supervisor::hub_link::{HubLink, HubLinkOptions, HubLinkSink, HubSender};
use veeloe_runtime_supervisor::llm::{HttpAnswer, HttpClient};
use veeloe_runtime_supervisor::tasks::{dispatch, forward, Inbound, Machine, MachineOutbox};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

const MACHINE_SEED: [u8; 32] = [0x33; 32];
const CONTROLLER_SEED: [u8; 32] = [0x44; 32];

struct Canned;

#[async_trait]
impl SupervisorLlm for Canned {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        LlmHttpResponse {
            status: 200,
            headers: Vec::new(),
            body: json!({
                "content": [{ "type": "text", "text": "hi" }],
                "stop_reason": "end_turn",
            })
            .to_string(),
        }
    }
}

/// No Provider on this Machine: the Task slices never ask for one.
struct NoProviders;

#[async_trait]
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

struct Slice {
    registry: AgentRegistry,
    workers: Workers,
    home: PathBuf,
    seen: Mutex<MemorySeenSequences>,
    outbox: Mutex<Option<Arc<MachineOutbox>>>,
    me: std::sync::Weak<Slice>,
}

impl HubLinkSink for Slice {
    fn log(&self, _line: &str) {}

    fn on_ready(&self, _machine: &str) {}

    fn on_envelope(&self, value: Value, send: &HubSender) {
        let outbox = {
            let mut held = self.outbox.lock().expect("outbox");
            if held.is_none() {
                *held = MachineOutbox::new(&self.home, &MACHINE_SEED, send.clone())
                    .ok()
                    .map(Arc::new);
            }
            held.clone()
        };
        let Some(outbox) = outbox else { return };
        let trusted: std::collections::HashSet<String> =
            [to_base64url(&public_key_of(&CONTROLLER_SEED))].into_iter().collect();
        let mut seen = self.seen.lock().expect("seen");
        let seen: &mut dyn veeloe_protocol::envelope::SeenSequences = &mut *seen;
        let Ok(verified) = verify(
            &value,
            &trusted,
            |route| matches!(route, Route::To(to) if to == "machine-1"),
            seen,
        ) else {
            return;
        };
        let from = Inbound {
            member: verified.signed.member.clone().unwrap_or_default(),
            reference: value
                .get("sig")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            task: verified.signed.task.clone(),
        };
        let Some(me) = self.me.upgrade() else { return };
        let type_ = verified.signed.type_.clone();
        let body = verified.signed.body.clone();
        tokio::spawn(async move {
            let http = NoProviders;
            let machine = Machine {
                registry: &me.registry,
                workers: &me.workers,
                providers: &[],
                egress: &[],
                budgets: None,
                http: &http,
            };
            dispatch(&machine, outbox.as_ref(), &from, &type_, &body).await;
        });
    }

    fn on_certificates(&self, _certificates: Vec<Value>) {}
}

impl Slice {
    /// What a worker says, signed back to the Member it belongs to.
    fn deliver(&self, agent: &str, message: FromWorker) {
        let outbox = self.outbox.lock().expect("outbox");
        if let Some(outbox) = outbox.as_ref() {
            forward(outbox.as_ref(), agent, message);
        }
    }
}

fn worker_binary() -> Vec<String> {
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
    let status = std::process::Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["build", "-p", "veeloe-runtime-supervisor", "--bin", "veeloe"])
        .status()
        .expect("build the worker");
    assert!(status.success(), "could not build veeloe");
    vec![
        beside.expect("a target folder").to_string_lossy().to_string(),
        "worker".to_string(),
    ]
}

fn prepare(home: &Path) {
    let key = home.join("machine.key");
    fs::write(&key, MACHINE_SEED).expect("key");
    fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).expect("mode");
    fs::create_dir_all(home.join("runtime")).expect("runtime");
    fs::write(
        home.join("runtime/trust.json"),
        json!({ "owners": [{ "member": "member-1", "keys": [to_base64url(&public_key_of(&CONTROLLER_SEED))] }] })
            .to_string(),
    )
    .expect("trust");
}

struct Controller {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    seq: u64,
}

impl Controller {
    async fn connect(hub_url: &str) -> Self {
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("{hub_url}/connect"))
            .await
            .expect("connect");
        let challenge = next_frame(&mut socket).await;
        let Frame::Known { value, .. } = parse_frame(&challenge) else {
            panic!("no challenge");
        };
        let answer =
            answer_challenge(hub_url, value["nonce"].as_str().expect("nonce"), &CONTROLLER_SEED)
                .expect("answer");
        socket
            .send(Message::Text(answer.to_string().into()))
            .await
            .expect("answer");
        let ready = next_frame(&mut socket).await;
        let Frame::Known { type_, .. } = parse_frame(&ready) else {
            panic!("not ready");
        };
        assert_eq!(type_, "hub.ready");
        Self { socket, seq: 0 }
    }

    async fn send(&mut self, type_: &str, task: Option<&str>, body: Value) {
        self.seq += 1;
        let envelope = Signer::new(&CONTROLLER_SEED).sign(
            Outgoing {
                type_: type_.into(),
                to: Some("machine-1".into()),
                recipients: None,
                task: task.map(str::to_string),
                member: Some("member-1".into()),
                body,
            },
            self.seq,
        );
        self.socket
            .send(Message::Text(
                serde_json::to_string(&envelope).expect("json").into(),
            ))
            .await
            .expect("send");
    }

    async fn next(&mut self) -> Value {
        serde_json::from_str(&next_frame(&mut self.socket).await).expect("json")
    }
}

async fn next_frame(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> String {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => return text.to_string(),
            Some(Ok(_)) => continue,
            other => panic!("no frame: {other:?}"),
        }
    }
}

fn body_of(envelope: &Value) -> Value {
    let signed: Value =
        serde_json::from_str(envelope["signed"].as_str().expect("signed")).expect("json");
    signed["body"].clone()
}

#[tokio::test]
async fn a_members_message_a_sync_a_list_and_a_stop_reach_the_worker_and_are_answered() {
    let hub = TestHub::start();
    let home = tempdir().expect("home");
    prepare(home.path());
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry
        .add(&Agent {
            id: "a1".into(),
            name: "Deployer".into(),
            provider: "main".into(),
            model: "model-a".into(),
            character: None,
            allowlist: Vec::new(),
            approval_timeout_s: 3_600,
            budget: None,
        })
        .expect("agent");

    // The workers need a way back to the outbox, and the outbox needs the Hub
    // connection the first envelope brings, so the slice is filled in after.
    let slot: Arc<Mutex<Option<Arc<Slice>>>> = Arc::new(Mutex::new(None));
    let delivering = Arc::clone(&slot);
    let workers = Workers::new(
        home.path().to_path_buf(),
        worker_binary(),
        Arc::new(Canned) as Arc<dyn SupervisorLlm>,
        Arc::new(move |agent: &str, message: FromWorker| {
            if let Some(slice) = delivering.lock().expect("slot").as_ref() {
                slice.deliver(agent, message);
            }
        }),
        Arc::new(|_line| {}),
        Arc::new(|_agent, command| command),
    );
    let slice = Arc::new_cyclic(|me| Slice {
        registry,
        workers,
        home: home.path().to_path_buf(),
        seen: Mutex::new(MemorySeenSequences::default()),
        outbox: Mutex::new(None),
        me: me.clone(),
    });
    *slot.lock().expect("slot") = Some(Arc::clone(&slice));
    let link = HubLink::start(
        HubLinkOptions {
            hub_url: hub.url.clone(),
            secret_key: MACHINE_SEED,
            base_ms: 10,
            cap_ms: 40,
        },
        Arc::clone(&slice) as Arc<dyn HubLinkSink>,
    );
    slice.workers.start(&slice.registry.get("a1").expect("get").expect("agent"));
    assert!(until(|| slice.workers.is_ready("a1"), 10_000).await);

    let mut controller = Controller::connect(&hub.url).await;
    controller
        .send(
            "task.message",
            Some("t1"),
            json!({ "agent": "a1", "id": "m-go", "text": "go" }),
        )
        .await;

    // Every event comes back signed, addressed to the Member who started it.
    let mut kinds = Vec::new();
    while !kinds.contains(&"turn.ended".to_string()) {
        let envelope = controller.next().await;
        assert_eq!(
            envelope["recipients"],
            json!(["member-1"]),
            "not addressed to the Member: {envelope}"
        );
        let body = body_of(&envelope);
        assert_eq!(body["agent"], "a1");
        kinds.push(body["kind"].as_str().unwrap_or_default().to_string());
    }
    assert_eq!(
        kinds,
        vec!["member.message", "turn.started", "llm.message", "turn.ended"]
    );

    // A sync is answered with the events after a number.
    controller
        .send("task.sync", Some("t1"), json!({ "agent": "a1", "after": 2 }))
        .await;
    let answer = controller.next().await;
    assert_eq!(answer["type"], "task.events");
    let body = body_of(&answer);
    assert_eq!(body["agent"], "a1");
    assert_eq!(body["events"].as_array().expect("events").len(), 2);

    // A list names the Task this Member started.
    controller.send("task.list", None, json!({})).await;
    let answer = controller.next().await;
    assert_eq!(answer["type"], "task.listed");
    let body = body_of(&answer);
    assert_eq!(body["tasks"][0]["id"], "t1");
    assert_eq!(body["tasks"][0]["agent"], "a1");

    // A Stop for a Turn that is not running comes back as an error, through the same route.
    controller
        .send("task.stop", Some("t1"), json!({ "agent": "a1", "id": "s-1" }))
        .await;
    let answer = controller.next().await;
    assert_eq!(answer["type"], "error");
    assert_eq!(body_of(&answer)["code"], "turn.not_running");

    link.stop().await;
    slice.workers.stop_all();
}

struct Sequence {
    replies: Mutex<std::collections::VecDeque<Value>>,
}

#[async_trait]
impl SupervisorLlm for Sequence {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        let body = self
            .replies
            .lock()
            .expect("replies")
            .pop_front()
            .unwrap_or_else(|| json!({ "content": [], "stop_reason": "end_turn" }));
        LlmHttpResponse {
            status: 200,
            headers: Vec::new(),
            body: body.to_string(),
        }
    }
}

#[tokio::test]
async fn an_approval_answer_reaches_the_worker_and_allow_always_grows_the_allowlist() {
    let hub = TestHub::start();
    let home = tempdir().expect("home");
    prepare(home.path());
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry
        .add(&Agent {
            id: "a1".into(),
            name: "Deployer".into(),
            provider: "main".into(),
            model: "model-a".into(),
            character: None,
            allowlist: Vec::new(),
            approval_timeout_s: 3_600,
            budget: None,
        })
        .expect("agent");

    let slot: Arc<Mutex<Option<Arc<Slice>>>> = Arc::new(Mutex::new(None));
    let delivering = Arc::clone(&slot);
    let workers = Workers::new(
        home.path().to_path_buf(),
        worker_binary(),
        Arc::new(Sequence {
            replies: Mutex::new(std::collections::VecDeque::from([
                json!({
                    "content": [{ "type": "tool_use", "id": "tu-ls", "name": "bash", "input": { "command": "ls" } }],
                    "stop_reason": "tool_use",
                }),
                json!({ "content": [{ "type": "text", "text": "done" }], "stop_reason": "end_turn" }),
            ])),
        }) as Arc<dyn SupervisorLlm>,
        Arc::new(move |agent: &str, message: FromWorker| {
            if let Some(slice) = delivering.lock().expect("slot").as_ref() {
                slice.deliver(agent, message);
            }
        }),
        Arc::new(|_line| {}),
        Arc::new(|_agent, command| command),
    );
    let slice = Arc::new_cyclic(|me| Slice {
        registry,
        workers,
        home: home.path().to_path_buf(),
        seen: Mutex::new(MemorySeenSequences::default()),
        outbox: Mutex::new(None),
        me: me.clone(),
    });
    *slot.lock().expect("slot") = Some(Arc::clone(&slice));
    let link = HubLink::start(
        HubLinkOptions {
            hub_url: hub.url.clone(),
            secret_key: MACHINE_SEED,
            base_ms: 10,
            cap_ms: 40,
        },
        Arc::clone(&slice) as Arc<dyn HubLinkSink>,
    );
    slice
        .workers
        .start(&slice.registry.get("a1").expect("get").expect("agent"));
    assert!(until(|| slice.workers.is_ready("a1"), 10_000).await);

    let mut controller = Controller::connect(&hub.url).await;
    controller
        .send(
            "task.message",
            Some("t1"),
            json!({ "agent": "a1", "id": "m-go", "text": "go" }),
        )
        .await;

    // `ls` is not in the Allowlist yet, so the worker asks before running it.
    let mut request = None;
    while request.is_none() {
        let envelope = controller.next().await;
        let body = body_of(&envelope);
        if body["kind"] == "approval.requested" {
            request = body["body"]["request"].as_str().map(str::to_string);
        }
    }
    let request = request.expect("a request");

    controller
        .send(
            "approval.answer",
            Some("t1"),
            json!({
                "agent": "a1",
                "request": request,
                "decision": "approve",
                "allowAlways": "ls",
            }),
        )
        .await;

    let mut ended = None;
    while ended.is_none() {
        let envelope = controller.next().await;
        let body = body_of(&envelope);
        if body["kind"] == "turn.ended" {
            ended = Some(body["body"]["reason"].clone());
        }
    }
    assert_eq!(ended.expect("ended"), json!("done"));

    // The answer ran the command, and allow-always wrote the entry down.
    let agent = slice.registry.get("a1").expect("get").expect("agent");
    assert_eq!(agent.allowlist, vec!["ls".to_string()]);

    link.stop().await;
    slice.workers.stop_all();
}
