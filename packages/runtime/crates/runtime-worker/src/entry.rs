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
    // The supervisor names how this process reaches it: a URL on macOS, whose
    // sandbox allows the proxy's port, or a Unix socket on Linux, whose network
    // namespace has no route to the supervisor at all. On Linux the worker
    // answers on its own loopback and forwards to that socket, so every command
    // gets the same kind of `HTTP_PROXY` either way (ADR 0069). A bridge that
    // cannot reach the socket ends the start: a worker with no way out is not
    // a worker with no network, it is one that fails every Turn halfway.
    let proxy_socket = std::env::args()
        .skip_while(|arg| arg != "--proxy-unix")
        .nth(1);
    let proxy = match proxy_socket {
        Some(socket) => {
            let bridge = crate::bridge::start(std::path::Path::new(&socket))
                .await
                .map_err(|error| format!("cannot reach the Egress proxy at {socket}: {error}"))?;
            Some(bridge.url)
        }
        None => std::env::args()
            .skip_while(|arg| arg != "--proxy")
            .nth(1)
            .filter(|url| url.starts_with("http://127.0.0.1:")),
    };

    let mut config = Config::new(dir, name);
    config.allowlist = allowlist;
    config.approval_timeout_ms = approval_timeout_ms;
    config.env = env;
    config.egress = egress;
    config.proxy = proxy;
    let worker = Arc::new(Worker::new(
        config,
        Arc::new(StdioLink {
            writing: Mutex::new(()),
        }),
    )?);

    // Reading happens on its own thread: the worker blocks on the supervisor's
    // answer to each log write and read, and that answer arrives on the same
    // stdin. A loop that both read and waited would wait forever.
    let (sending, mut messages) = tokio::sync::mpsc::unbounded_channel();
    let replying = Arc::clone(&worker);
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in std::io::BufRead::lines(stdin.lock()) {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<ToWorker>(&line) else {
                // The supervisor writes these frames, so one this side cannot
                // read is its bug, not a reason to end the Agent. Nothing of
                // the frame is repeated: it can carry a Task's words. The
                // supervisor inherits this process's stderr, so the line is
                // visible in the Runtime log.
                eprintln!("veeloe: worker skipped one unreadable frame from the supervisor");
                continue;
            };
            if replying.reply(&message) {
                continue;
            }
            if sending.send(message).is_err() {
                break;
            }
        }
    });

    worker.start()?;
    while let Some(message) = messages.recv().await {
        worker.receive(message)?;
    }
    Ok(())
}
