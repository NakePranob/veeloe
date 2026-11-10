//! Pairing this Machine with a Controller, ported from
//! `packages/runtime-legacy/src/supervisor/pairing/pair.ts`.
//!
//! Shows the link and waits for a Controller to prove it read it (ADR 0013). A
//! claim only counts when its proof covers the key that signed it, so a Hub that
//! saw a real proof cannot put its own key in. The secret lives only in this call.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::sync::oneshot;
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::envelope::{verify, Route, SeenSequences};
use veeloe_protocol::messages::message_is_valid;
use veeloe_protocol::pairing::{build_pairing_link, check_pairing_proof, PAIRING_TTL_SECONDS};
use veeloe_protocol::signer::{Outgoing, Signer};

use crate::hub_link::{HubLink, HubLinkOptions, HubLinkSink, HubSender};
use crate::trust::{
    load_or_create_machine_key, load_trust, machine_name, save_hub_url, save_trust, FileSeenSequences,
    Owner, Trust, TrustError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairResult {
    Paired,
    Expired,
    AlreadyPaired,
}

#[derive(Debug, Clone)]
pub struct PairOptions {
    pub home: PathBuf,
    pub hub_url: String,
    pub name: String,
    pub ttl_seconds: u64,
}

impl PairOptions {
    pub fn new(home: impl Into<PathBuf>, hub_url: impl Into<String>) -> Self {
        Self {
            home: home.into(),
            hub_url: hub_url.into(),
            name: machine_name(),
            ttl_seconds: PAIRING_TTL_SECONDS,
        }
    }
}

/// A line for the operator. The link is printed through this too.
pub type PairLog = Arc<dyn Fn(&str) + Send + Sync>;

struct PairSink {
    home: PathBuf,
    hub_url: String,
    name: String,
    secret: String,
    machine_key: String,
    secret_key: [u8; 32],
    log: PairLog,
    machine: Mutex<Option<String>>,
    done: Mutex<Option<oneshot::Sender<PairResult>>>,
}

impl HubLinkSink for PairSink {
    fn log(&self, line: &str) {
        (self.log)(line);
    }

    fn on_ready(&self, machine: &str) {
        *self.machine.lock().expect("machine") = Some(machine.to_string());
    }

    fn on_envelope(&self, value: Value, send: &HubSender) {
        // Any key may try here: nobody is trusted yet, and the proof is the check.
        let machine = self.machine.lock().expect("machine").clone();
        let mut seen = match FileSeenSequences::open(&self.home) {
            Ok(seen) => seen,
            Err(error) => {
                (self.log)(&format!("cannot read this Machine's counters: {error}"));
                return;
            }
        };
        // Any key may try here: nobody is trusted yet, so the key the envelope
        // names is let through and the proof below is the check.
        let any: std::collections::HashSet<String> = value
            .get("from")
            .and_then(Value::as_str)
            .map(|from| [from.to_string()].into_iter().collect())
            .unwrap_or_default();
        let result = verify(
            &value,
            &any,
            |route| matches!(route, Route::To(to) if Some(to) == machine.as_ref()),
            &mut seen,
        );
        let Ok(verified) = result else {
            return;
        };
        if verified.signed.type_ != "pairing.claim" {
            return;
        }
        if message_is_valid("pairing.claim", &verified.signed.body) != Some(true) {
            return;
        }
        let body = &verified.signed.body;
        let member = body
            .get("member")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let proof = body.get("proof").and_then(Value::as_str).unwrap_or_default();
        let keys: Vec<String> = body
            .get("keys")
            .and_then(Value::as_array)
            .map(|keys| {
                keys.iter()
                    .filter_map(|key| key.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let workspace = body
            .get("workspace")
            .and_then(Value::as_str)
            .map(str::to_string);
        if !check_pairing_proof(&self.secret, &self.machine_key, &verified.from, &member, proof) {
            (self.log)("ignored a claim whose proof did not match this link");
            return;
        }

        // The Member's other keys come in the claim, signed by the key the proof
        // vouches for, so a Machine paired from any of their devices trusts them all.
        let mut all = vec![verified.from.clone()];
        for key in keys {
            if !all.contains(&key) {
                all.push(key);
            }
        }
        let trust = Trust {
            owners: vec![Owner {
                member: member.clone(),
                keys: all,
            }],
            workspace,
            links: Vec::new(),
            revoked: Vec::new(),
        };
        if let Err(error) = save_trust(&self.home, &trust) {
            (self.log)(&format!("cannot write this Machine's trust: {error}"));
            return;
        }
        if let Err(error) = save_hub_url(&self.home, &self.hub_url) {
            (self.log)(&format!("cannot write this Machine's config: {error}"));
            return;
        }
        let mut seen = match FileSeenSequences::open(&self.home) {
            Ok(seen) => seen,
            Err(error) => {
                (self.log)(&format!("cannot read this Machine's counters: {error}"));
                return;
            }
        };
        seen.record(&verified.from, verified.signed.seq);
        let signer = Signer::new(&self.secret_key);
        let seq = seen.next(&self.machine_key);
        let done = signer.sign(
            Outgoing {
                type_: "pairing.done".into(),
                to: None,
                recipients: Some(vec![member]),
                task: None,
                member: None,
                body: json!({ "name": self.name }),
            },
            seq,
        );
        send.send(serde_json::to_value(done).expect("pairing.done is json"));
        (self.log)(&format!("paired with hub {}.", self.hub_url));
        if let Some(done) = self.done.lock().expect("done").take() {
            let _ = done.send(PairResult::Paired);
        }
    }

    fn on_certificates(&self, _certificates: Vec<Value>) {}
}

/// Shows the link and waits for a Controller to prove it read it. The link is
/// handed to `log` so a terminal can draw it as a QR code.
pub async fn run_pair(options: PairOptions, log: PairLog) -> Result<PairResult, TrustError> {
    if !load_trust(&options.home)?.owners.is_empty() {
        log("this Machine is already paired. To start over, run: veeloe unpair");
        return Ok(PairResult::AlreadyPaired);
    }

    let secret_key = load_or_create_machine_key(&options.home)?;
    let machine_key = to_base64url(&public_key_of(&secret_key));
    let secret_bytes = random_bytes();
    let secret = to_base64url(&secret_bytes);
    let expires = now_s() + options.ttl_seconds;
    let link = build_pairing_link(&options.hub_url, &secret_key, &secret_bytes, expires)
        .map_err(|error| TrustError::Hub(error.to_string()))?;
    log(&link);
    log(&format!(
        "Waiting up to {} minutes for hub {}...",
        options.ttl_seconds / 60,
        options.hub_url
    ));

    let (done, finished) = oneshot::channel();
    let sink = Arc::new(PairSink {
        home: options.home.clone(),
        hub_url: options.hub_url.clone(),
        name: options.name.clone(),
        secret,
        machine_key,
        secret_key,
        log: Arc::clone(&log),
        machine: Mutex::new(None),
        done: Mutex::new(Some(done)),
    });
    let hub = HubLink::start(
        HubLinkOptions {
            hub_url: options.hub_url.clone(),
            secret_key,
            base_ms: 100,
            cap_ms: 3_000,
        },
        sink,
    );

    let result = tokio::select! {
        result = finished => result.unwrap_or(PairResult::Expired),
        _ = tokio::time::sleep(Duration::from_secs(options.ttl_seconds)) => {
            log("the link has expired and nothing was paired. Run veeloe pair again.");
            PairResult::Expired
        }
    };
    hub.stop().await;
    Ok(result)
}

/// The pairing link for a folder, so a caller that only wants to show it does
/// not have to wait. Returns the link and the secret it carries.
pub fn pairing_link(home: &Path, hub_url: &str, ttl_seconds: u64) -> Result<String, TrustError> {
    let secret_key = load_or_create_machine_key(home)?;
    let secret = random_bytes();
    let expires = now_s() + ttl_seconds;
    build_pairing_link(hub_url, &secret_key, &secret, expires)
        .map_err(|error| TrustError::Hub(error.to_string()))
}

fn random_bytes() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    let filled = unsafe {
        libc::getentropy(
            bytes.as_mut_ptr() as *mut libc::c_void,
            bytes.len() as libc::size_t,
        )
    };
    assert_eq!(filled, 0, "the operating system has no entropy");
    bytes
}

fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}
