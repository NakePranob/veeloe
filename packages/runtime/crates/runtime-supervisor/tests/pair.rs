//! Pairing, through the real relay in Go with a Controller that signs the way
//! the app does. The app's own screen is exercised in task 3.5.

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use support::{until, TestHub};
use tempfile::tempdir;
use tokio_tungstenite::tungstenite::Message;
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::frame::{parse_frame, Frame};
use veeloe_protocol::hub_auth::answer_challenge;
use veeloe_protocol::pairing::{pairing_proof, parse_pairing_link};
use veeloe_protocol::signer::{Outgoing, Signer};
use veeloe_runtime_supervisor::pair::{run_pair, PairOptions, PairResult};
use veeloe_runtime_supervisor::trust::{load_trust, FileSeenSequences};

/// The keys `cmd/testhub` knows: TEST-ONLY fixed seeds, the ones e2e uses.
const MACHINE_SEED: [u8; 32] = [0x33; 32];
const CONTROLLER_SEED: [u8; 32] = [0x44; 32];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// Writes the Machine key the test Hub knows, the way the legacy Runtime wrote
/// it: 32 raw bytes, owner-only.
fn write_machine_key(home: &Path) {
    let file = home.join("machine.key");
    fs::write(&file, MACHINE_SEED).expect("machine key");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).expect("mode");
}

struct Controller {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
}

impl Controller {
    async fn connect(hub_url: &str) -> Self {
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("{hub_url}/connect"))
            .await
            .expect("controller connects");
        let challenge = next_frame(&mut socket).await;
        let Frame::Known { type_, value } = parse_frame(&challenge) else {
            panic!("no challenge: {challenge}");
        };
        assert_eq!(type_, "hub.challenge");
        let nonce = value["nonce"].as_str().expect("nonce");
        let answer = answer_challenge(hub_url, nonce, &CONTROLLER_SEED).expect("answer");
        socket
            .send(Message::Text(answer.to_string().into()))
            .await
            .expect("answer the challenge");
        let ready = next_frame(&mut socket).await;
        let Frame::Known { type_, value } = parse_frame(&ready) else {
            panic!("not ready: {ready}");
        };
        assert_eq!(type_, "hub.ready");
        assert_eq!(value["member"], "member-1");
        Self { socket }
    }

    async fn send(&mut self, value: Value) {
        self.socket
            .send(Message::Text(value.to_string().into()))
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

#[tokio::test]
async fn a_controller_pairs_this_machine_through_the_real_hub() {
    let hub = TestHub::start();
    let home = tempdir().expect("home");
    write_machine_key(home.path());

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&lines);
    let log: veeloe_runtime_supervisor::pair::PairLog =
        Arc::new(move |line: &str| recorded.lock().expect("lines").push(line.to_string()));

    let pairing = {
        let mut options = PairOptions::new(home.path(), hub.url.clone());
        options.name = "test-machine".into();
        options.ttl_seconds = 10;
        tokio::spawn(run_pair(options, log))
    };

    // The Machine shows its link; the Controller reads it the way a camera would.
    assert!(
        until(
            || lines
                .lock()
                .expect("lines")
                .iter()
                .any(|line| line.starts_with("veeloe://pair?")),
            5_000
        )
        .await,
        "no pairing link: {:?}",
        lines.lock().expect("lines")
    );
    let link = lines
        .lock()
        .expect("lines")
        .iter()
        .find(|line| line.starts_with("veeloe://pair?"))
        .cloned()
        .expect("link");
    let parsed = parse_pairing_link(&link, now_ms()).expect("a link the Machine signed");

    let mut controller = Controller::connect(&hub.url).await;
    let controller_key = to_base64url(&public_key_of(&CONTROLLER_SEED));
    let proof = pairing_proof(&parsed.secret, &parsed.machine, &controller_key, "member-1")
        .expect("proof");
    let claim = Signer::new(&CONTROLLER_SEED).sign(
        Outgoing {
            type_: "pairing.claim".into(),
            to: Some("machine-1".into()),
            recipients: None,
            task: None,
            member: None,
            body: json!({
                "member": "member-1",
                "proof": proof,
                "keys": [controller_key],
                "workspace": "w-1",
            }),
        },
        1,
    );
    controller.send(serde_json::to_value(claim).expect("claim")).await;

    // The Machine answers `pairing.done` on the same connection.
    let done = controller.next().await;
    assert_eq!(done["type"], "pairing.done");
    // The body rides inside the signed part, never beside it.
    let signed: Value = serde_json::from_str(done["signed"].as_str().expect("signed")).expect("json");
    assert_eq!(signed["body"]["name"], "test-machine");

    assert_eq!(
        pairing.await.expect("pairing task").expect("paired"),
        PairResult::Paired
    );
    let trust = load_trust(home.path()).expect("trust");
    assert_eq!(trust.owners.len(), 1);
    assert_eq!(trust.owners[0].member, "member-1");
    assert_eq!(trust.owners[0].keys, vec![controller_key.clone()]);
    assert_eq!(trust.workspace.as_deref(), Some("w-1"));

    let config: Value =
        serde_json::from_str(&fs::read_to_string(home.path().join("config.json")).expect("config"))
            .expect("json");
    assert_eq!(config["hubUrl"], hub.url);

    // The claim's number is remembered, so the same one cannot be replayed.
    let seen = FileSeenSequences::open(home.path()).expect("seen");
    assert_eq!(
        veeloe_protocol::envelope::SeenSequences::last(&seen, &controller_key),
        Some(1)
    );
}

#[tokio::test]
async fn a_claim_whose_proof_does_not_match_the_link_is_ignored() {
    let hub = TestHub::start();
    let home = tempdir().expect("home");
    write_machine_key(home.path());

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&lines);
    let log: veeloe_runtime_supervisor::pair::PairLog =
        Arc::new(move |line: &str| recorded.lock().expect("lines").push(line.to_string()));

    let pairing = {
        let mut options = PairOptions::new(home.path(), hub.url.clone());
        options.ttl_seconds = 2;
        tokio::spawn(run_pair(options, log))
    };
    assert!(
        until(
            || lines
                .lock()
                .expect("lines")
                .iter()
                .any(|line| line.starts_with("veeloe://pair?")),
            5_000
        )
        .await
    );

    let mut controller = Controller::connect(&hub.url).await;
    let claim = Signer::new(&CONTROLLER_SEED).sign(
        Outgoing {
            type_: "pairing.claim".into(),
            to: Some("machine-1".into()),
            recipients: None,
            task: None,
            member: None,
            body: json!({ "member": "member-1", "proof": "not-the-proof" }),
        },
        1,
    );
    controller.send(serde_json::to_value(claim).expect("claim")).await;

    assert!(
        until(
            || lines
                .lock()
                .expect("lines")
                .iter()
                .any(|line| line.contains("proof did not match this link")),
            5_000
        )
        .await,
        "the claim was not refused: {:?}",
        lines.lock().expect("lines")
    );
    // Nothing was trusted, and the wait goes on until the link expires.
    assert_eq!(
        pairing.await.expect("pairing task").expect("expired"),
        PairResult::Expired
    );
    assert!(load_trust(home.path()).expect("trust").owners.is_empty());
}

#[tokio::test]
async fn a_machine_that_is_already_paired_does_not_pair_again() {
    let home = tempdir().expect("home");
    write_machine_key(home.path());
    fs::create_dir_all(home.path().join("runtime")).expect("runtime");
    fs::write(
        home.path().join("runtime/trust.json"),
        json!({ "owners": [{ "member": "member-1", "keys": ["k"] }] }).to_string(),
    )
    .expect("trust");

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&lines);
    let log: veeloe_runtime_supervisor::pair::PairLog =
        Arc::new(move |line: &str| recorded.lock().expect("lines").push(line.to_string()));
    let result = run_pair(
        PairOptions::new(home.path(), "ws://127.0.0.1:1"),
        log,
    )
    .await
    .expect("pair");
    assert_eq!(result, PairResult::AlreadyPaired);
    assert!(lines
        .lock()
        .expect("lines")
        .iter()
        .any(|line| line.contains("already paired")));
}
