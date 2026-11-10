//! One worker process per Agent (ADR 0020), ported from
//! `packages/runtime-legacy/src/supervisor/workers/workers.ts`.
//!
//! A worker that ends without being told is started again, later each time.
//! Messages wait for a worker that is starting, and come back as
//! `agent.unavailable` if it dies before it reads them. Its LLM requests come
//! over its own IPC, so which Agent sent one is never in question (ADR 0042).

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, watch};
use veeloe_protocol::backoff::Backoff;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse, ToWorker};

use crate::agents::{agent_dir, Agent};
use crate::hub_link::random;

/// A worker that lived this long counts as having started fine, so its next
/// crash waits the shortest time again.
const HEALTHY: Duration = Duration::from_secs(60);

/// The supervisor's answer to one LLM request. The key stays here (ADR 0042).
#[async_trait]
pub trait SupervisorLlm: Send + Sync {
    async fn answer(&self, agent: &str, request: LlmHttpRequest) -> LlmHttpResponse;
}

pub type OnMessage = Arc<dyn Fn(&str, FromWorker) + Send + Sync>;
/// Wraps the worker's own argv in the rules it must run under (task 4.4).
pub type Wrap = Arc<dyn Fn(&Agent, Vec<String>) -> Vec<String> + Send + Sync>;
pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

struct Entry {
    frames: mpsc::UnboundedSender<ToWorker>,
    ready: watch::Receiver<bool>,
}

struct Inner {
    home: PathBuf,
    /// How to run the worker: `[veeloe-worker]`, or a source path in tests.
    command: Vec<String>,
    llm: Arc<dyn SupervisorLlm>,
    on_message: OnMessage,
    log: Log,
    wrap: Wrap,
    running: Mutex<HashMap<String, Entry>>,
    stopping: AtomicBool,
}

pub struct Workers {
    inner: Arc<Inner>,
}

impl Workers {
    pub fn new(
        home: PathBuf,
        command: Vec<String>,
        llm: Arc<dyn SupervisorLlm>,
        on_message: OnMessage,
        log: Log,
        wrap: Wrap,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                home,
                command,
                llm,
                on_message,
                log,
                wrap,
                running: Mutex::new(HashMap::new()),
                stopping: AtomicBool::new(false),
            }),
        }
    }

    /// Starts this Agent's worker unless it is already running.
    pub fn start(&self, agent: &Agent) {
        let mut running = self.inner.running.lock().expect("running");
        if running.contains_key(&agent.id) {
            return;
        }
        let (frames, queue) = mpsc::unbounded_channel();
        let (ready, watching) = watch::channel(false);
        running.insert(
            agent.id.clone(),
            Entry {
                frames,
                ready: watching,
            },
        );
        drop(running);
        let inner = Arc::clone(&self.inner);
        let agent = agent.clone();
        tokio::spawn(async move { run(inner, agent, queue, ready).await });
    }

    /// False when this Agent has no worker: the frame is not kept.
    pub fn send(&self, agent: &str, message: ToWorker) -> bool {
        let running = self.inner.running.lock().expect("running");
        match running.get(agent) {
            Some(entry) => entry.frames.send(message).is_ok(),
            None => false,
        }
    }

    pub fn is_ready(&self, agent: &str) -> bool {
        let running = self.inner.running.lock().expect("running");
        running
            .get(agent)
            .map(|entry| *entry.ready.borrow())
            .unwrap_or(false)
    }

    /// The name, Allowlist and Approval timeout now in force reach the worker
    /// that is running (ADR 0023).
    pub fn rename(&self, agent: &Agent) {
        self.send(
            &agent.id,
            ToWorker::Agent {
                name: agent.name.clone(),
                allowlist: Some(agent.allowlist.clone()),
                approval_timeout_s: Some(agent.approval_timeout_s),
            },
        );
    }

    /// Stops every worker, for good: the supervisor is ending.
    pub fn stop_all(&self) {
        self.inner.stopping.store(true, Ordering::SeqCst);
        self.inner.running.lock().expect("running").clear();
    }
}

struct Ending {
    stopped: bool,
    why: String,
}

async fn run(
    inner: Arc<Inner>,
    agent: Agent,
    mut queue: mpsc::UnboundedReceiver<ToWorker>,
    ready: watch::Sender<bool>,
) {
    let mut backoff = Backoff::new(1_000, 30_000);
    let mut waiting: Vec<ToWorker> = Vec::new();
    loop {
        let started = Instant::now();
        let ending = session(&inner, &agent, &mut queue, &mut waiting, &ready).await;
        if ending.stopped || inner.stopping.load(Ordering::SeqCst) {
            return;
        }
        if started.elapsed() > HEALTHY {
            backoff.reset();
        }
        let delay = backoff.next_with(random());
        (inner.log)(&format!(
            "worker of agent {} ended ({}); starting it again in {delay} ms",
            agent.id, ending.why
        ));
        tokio::time::sleep(Duration::from_millis(delay)).await;
        if inner.stopping.load(Ordering::SeqCst) {
            return;
        }
    }
}

async fn session(
    inner: &Arc<Inner>,
    agent: &Agent,
    queue: &mut mpsc::UnboundedReceiver<ToWorker>,
    waiting: &mut Vec<ToWorker>,
    ready: &watch::Sender<bool>,
) -> Ending {
    let dir = match agent_dir(&inner.home, &agent.id) {
        Ok(dir) => dir,
        Err(error) => {
            return Ending {
                stopped: false,
                why: error.to_string(),
            }
        }
    };
    let argv = (inner.wrap)(agent, inner.command.clone());
    let Some((program, rest)) = argv.split_first() else {
        return Ending {
            stopped: false,
            why: "no command to run".into(),
        };
    };
    let mut command = Command::new(program);
    command.args(rest);
    command
        .env_clear()
        // Only what a worker needs. Never a Provider's key: the supervisor holds
        // that (ADR 0042).
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env("TMPDIR", dir.join("tmp"))
        .env("VEELOE_AGENT_DIR", &dir)
        .env("VEELOE_AGENT_NAME", &agent.name)
        .env(
            "VEELOE_AGENT_ALLOWLIST",
            serde_json::to_string(&agent.allowlist).unwrap_or_else(|_| "[]".into()),
        )
        .env(
            "VEELOE_AGENT_APPROVAL_TIMEOUT_S",
            agent.approval_timeout_s.to_string(),
        )
        .current_dir(dir.join("workdir"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child: Child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ending {
                stopped: false,
                why: format!("could not start: {error}"),
            }
        }
    };
    let mut writing = child.stdin.take().expect("stdin is piped");
    let mut lines = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let mut is_ready = false;

    let ending = loop {
        tokio::select! {
            frame = queue.recv() => match frame {
                Some(frame) => {
                    if is_ready {
                        write(&mut writing, &frame).await;
                    } else {
                        waiting.push(frame);
                    }
                }
                None => {
                    let _ = child.kill().await;
                    break Ending { stopped: true, why: "stopped".into() };
                }
            },
            line = lines.next_line() => match line {
                Ok(Some(line)) => {
                    let Ok(message) = serde_json::from_str::<FromWorker>(&line) else {
                        continue;
                    };
                    match message {
                        FromWorker::Ready => {
                            is_ready = true;
                            let _ = ready.send(true);
                            for queued in waiting.drain(..) {
                                write(&mut writing, &queued).await;
                            }
                        }
                        FromWorker::LlmRequest { id, method, path, headers, body } => {
                            let answer = inner
                                .llm
                                .answer(&agent.id, LlmHttpRequest { method, path, headers, body })
                                .await;
                            write(
                                &mut writing,
                                &ToWorker::LlmResponse {
                                    id,
                                    status: answer.status,
                                    headers: answer.headers,
                                    body: answer.body,
                                },
                            )
                            .await;
                        }
                        other => (inner.on_message)(&agent.id, other),
                    }
                }
                Ok(None) | Err(_) => {
                    let _ = child.wait().await;
                    break Ending { stopped: false, why: "it ended".into() };
                }
            },
        }
    };

    let _ = ready.send(false);
    // A message that never reached the worker is reported, not lost quietly.
    for lost in waiting.drain(..) {
        if let Some((member, reference, task)) = failed(&lost) {
            (inner.on_message)(
                &agent.id,
                FromWorker::Error {
                    member,
                    reference,
                    code: "agent.unavailable".into(),
                    task,
                },
            );
        }
    }
    ending
}

/// Who asked for this message, so a worker that never read it can be answered.
fn failed(message: &ToWorker) -> Option<(String, String, Option<String>)> {
    match message {
        ToWorker::Message {
            task,
            member,
            reference,
            ..
        }
        | ToWorker::Sync {
            task,
            member,
            reference,
            ..
        } => Some((member.clone(), reference.clone(), Some(task.clone()))),
        ToWorker::Stop {
            task,
            member,
            reference,
            ..
        } => Some((member.clone(), reference.clone(), Some(task.clone()))),
        ToWorker::Approval {
            member, reference, ..
        } => Some((member.clone(), reference.clone(), None)),
        _ => None,
    }
}

async fn write(stdin: &mut ChildStdin, message: &ToWorker) {
    let Ok(text) = serde_json::to_string(message) else {
        return;
    };
    let _ = stdin.write_all(format!("{text}\n").as_bytes()).await;
    let _ = stdin.flush().await;
}
