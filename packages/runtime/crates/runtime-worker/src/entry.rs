//! One Agent's process (ADR 0020), inside the sandbox the supervisor started
//! it in (ADR 0008). The `veeloe` binary runs this in its hidden `worker` mode,
//! so a release is still one file.
//!
//! It talks to the supervisor over stdin/stdout, one JSON message per line, and
//! ends when the supervisor does. Ported from
//! `packages/runtime-legacy/src/worker/index.ts`.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use tokio::io::AsyncBufReadExt;
use veeloe_runtime_core::{FromWorker, SupervisorLink, ToWorker};
use crate::worker::{Config, Worker};

/// The Allowlist the supervisor packed into the environment; empty when it is
/// missing or broken.
fn read_allowlist(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<String>>(raw) {
        Ok(entries) => entries,
        Err(_) => Vec::new(),
    }
}

/// The Approval timeout the supervisor packed into the environment, in seconds;
/// an hour when missing or out of range.
fn read_timeout_s(raw: Option<&str>) -> Option<u64> {
    let seconds: u64 = raw?.trim().parse().ok()?;
    (60..=86_400).contains(&seconds).then_some(seconds)
}

struct StdioLink {
    writing: Mutex<()>,
}

impl SupervisorLink for StdioLink {
    fn send(&self, message: FromWorker) {
        let _guard = self.writing.lock().expect("stdout");
        let mut out = std::io::stdout().lock();
        if serde_json::to_writer(&mut out, &message).is_ok() {
            let _ = writeln!(out);
            let _ = out.flush();
        }
    }
}

pub async fn run_stdio() -> Result<(), Box<dyn std::error::Error>> {
    let (Ok(dir), Ok(name)) = (
        std::env::var("VEELOE_AGENT_DIR"),
        std::env::var("VEELOE_AGENT_NAME"),
    ) else {
        return Err("start me from the supervisor".into());
    };
    let allowlist = read_allowlist(std::env::var("VEELOE_AGENT_ALLOWLIST").ok().as_deref());
    let approval_timeout_ms = read_timeout_s(
        std::env::var("VEELOE_AGENT_APPROVAL_TIMEOUT_S")
            .ok()
            .as_deref(),
    )
    .map(|seconds| seconds * 1_000);
    let env: HashMap<String, String> = std::env::vars().collect();
    // The supervisor names the Egress it started this worker with; a list that
    // does not read lets nothing out.
    let egress = std::env::args()
        .skip_while(|arg| arg != "--egress")
        .nth(1)
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default();
    let proxy = std::env::args()
        .skip_while(|arg| arg != "--proxy")
        .nth(1)
        .filter(|url| url.starts_with("http://127.0.0.1:"));

    let mut config = Config::new(dir, name);
    config.allowlist = allowlist;
    config.approval_timeout_ms = approval_timeout_ms;
    config.env = env;
    config.egress = egress;
    config.proxy = proxy;
    let worker = Worker::new(config, Arc::new(StdioLink { writing: Mutex::new(()) }))?;
    worker.start()?;

    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let message: ToWorker = serde_json::from_str(&line)?;
        worker.receive(message)?;
    }
    Ok(())
}
