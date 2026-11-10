//! The Machine's Hub link, against the real relay in Go (`hub/cmd/testhub`).
//!
//! The Hub is built once and each test gets its own process, so nothing here
//! stands in for the Hub's own handshake.

use std::sync::{Arc, Mutex};

use serde_json::Value;
mod support;

use support::{until, TestHub};
use veeloe_runtime_supervisor::hub_link::{HubLink, HubLinkOptions, HubLinkSink, HubSender};

/// The Machine key `cmd/testhub` knows: TEST-ONLY, the fixed seed the e2e tests use.
const MACHINE_SEED: [u8; 32] = [0x33; 32];
/// A key the Hub does not know.
const STRANGER_SEED: [u8; 32] = [0x55; 32];

#[derive(Default)]
struct Recording {
    lines: Mutex<Vec<String>>,
    ready: Mutex<Vec<String>>,
    certificates: Mutex<Vec<Value>>,
}

impl HubLinkSink for Recording {
    fn log(&self, line: &str) {
        self.lines.lock().expect("lines").push(line.to_string());
    }

    fn on_ready(&self, machine: &str) {
        self.ready.lock().expect("ready").push(machine.to_string());
    }

    fn on_envelope(&self, _value: Value, _send: &HubSender) {}

    fn on_certificates(&self, certificates: Vec<Value>) {
        self.certificates
            .lock()
            .expect("certificates")
            .extend(certificates);
    }
}

impl Recording {
    fn lines(&self) -> Vec<String> {
        self.lines.lock().expect("lines").clone()
    }

    fn ready(&self) -> Vec<String> {
        self.ready.lock().expect("ready").clone()
    }
}

fn options(hub: &TestHub, seed: [u8; 32]) -> HubLinkOptions {
    HubLinkOptions {
        hub_url: hub.url.clone(),
        secret_key: seed,
        base_ms: 10,
        cap_ms: 40,
    }
}

#[tokio::test]
async fn the_machine_answers_the_hubs_challenge_and_is_ready() {
    let hub = TestHub::start();
    let sink = Arc::new(Recording::default());
    let link = HubLink::start(options(&hub, MACHINE_SEED), Arc::clone(&sink) as Arc<dyn HubLinkSink>);

    assert!(
        until(|| !sink.ready().is_empty(), 5_000).await,
        "never became ready: {:?}",
        sink.lines()
    );
    assert_eq!(sink.ready(), vec!["machine-1".to_string()]);
    assert_eq!(
        sink.lines().first().map(String::as_str),
        Some(format!("connected to hub {} as machine machine-1", hub.url).as_str())
    );
    assert!(link.is_connected());

    link.stop().await;
}

#[tokio::test]
async fn a_key_the_hub_does_not_know_is_refused_with_its_code_and_retried() {
    let hub = TestHub::start();
    let sink = Arc::new(Recording::default());
    let link = HubLink::start(
        options(&hub, STRANGER_SEED),
        Arc::clone(&sink) as Arc<dyn HubLinkSink>,
    );

    assert!(
        until(
            || sink
                .lines()
                .iter()
                .filter(|line| line.contains("does not know this Machine's key"))
                .count()
                >= 2,
            5_000
        )
        .await,
        "never retried: {:?}",
        sink.lines()
    );
    let first = sink.lines().first().cloned().expect("a first line");
    assert!(
        first.starts_with("hub rejected or unreachable: the Hub does not know this Machine's key"),
        "{first}"
    );
    assert!(first.contains("(4401); retrying in "), "{first}");
    assert!(sink.ready().is_empty());

    link.stop().await;
}

#[tokio::test]
async fn a_frame_sent_before_the_handshake_is_not_kept() {
    let hub = TestHub::start();
    let sink = Arc::new(Recording::default());
    let link = HubLink::start(options(&hub, MACHINE_SEED), Arc::clone(&sink) as Arc<dyn HubLinkSink>);

    // Nothing is accepted yet, so the frame is dropped rather than queued.
    let early = link.send(serde_json::json!({ "type": "task.message", "to": "machine-1" }));
    assert!(
        until(|| link.is_connected(), 5_000).await,
        "never connected: {:?}",
        sink.lines()
    );
    // Once ready, the same frame goes out on the accepted connection.
    assert!(link.send(serde_json::json!({ "type": "task.message", "to": "machine-1" })));
    assert!(!early);

    link.stop().await;
}
