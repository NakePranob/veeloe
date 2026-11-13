//! One worker process per Agent (ADR 0020), ported from
//! `packages/runtime-legacy/src/supervisor/workers/workers.ts`.
//!
//! A worker that ends without being told is started again, later each time.
//! Messages wait for a worker that is starting, and come back as
//! `agent.unavailable` if it dies before it reads them. Its LLM requests come
//! over its own IPC, so which Agent sent one is never in question (ADR 0042).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, watch};
use veeloe_protocol::backoff::Backoff;
use veeloe_runtime_core::sandbox::{self, Policy, Sandbox};
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse, ToWorker};

use crate::agents::{agent_dir, Agent};
use crate::hub_link::random;
use crate::task_log::TaskLogs;
use crate::toolchain::{Report, Reported};

/// A worker that lived this long counts as having started fine, so its next
/// crash waits the shortest time again.
const HEALTHY: Duration = Duration::from_secs(60);

/// The supervisor's answer to one LLM request. The key stays here (ADR 0042).
#[async_trait]
pub trait SupervisorLlm: Send + Sync {
    async fn answer(&self, agent: &str, request: LlmHttpRequest) -> LlmHttpResponse;
}

pub type OnMessage = Arc<dyn Fn(&str, FromWorker) + Send + Sync>;
/// Wraps the worker's own argv in the rules it must run under. An empty argv
/// means it may not run, and its session ends before it starts.
pub type Wrap = Arc<dyn Fn(&Agent, Vec<String>) -> Vec<String> + Send + Sync>;
/// Reports the toolchains this Agent's worker cannot run, as it opens. `None`
/// when the Runtime has no check to make for it. What comes back is written at
/// Runtime log level; nothing waits for it and nothing fails because of it
/// (issue #35).
pub type Toolchains = Arc<dyn Fn(&Agent, &Path) -> Option<Vec<Report>> + Send + Sync>;

/// The Wrap a Runtime uses: each worker inside its own Agent's sandbox, which
/// every command it starts inherits, reaching the network only through that
/// Agent's own Egress proxy (ADR 0008, 0029, 0069). On a system with no
/// sandbox, or an Agent whose folder or proxy cannot be made, no worker runs.
pub fn sandboxed(home: PathBuf, proxies: Arc<crate::proxy::Proxies>) -> Wrap {
    Arc::new(move |agent, mut command| {
        // The folder of the program the worker runs, which must be readable to
        // start it: the `veeloe` binary itself in a release.
        let Some(bin) = program_dir(&command) else {
            return Vec::new();
        };
        // No listener means no way out, so there is no worker to start: another
        // Agent's proxy is never a fallback (ADR 0029, issue #43).
        let Some(proxy) = proxies.get(&agent.id) else {
            return Vec::new();
        };
        let Some(policy) = rules(&home, agent, &bin, &proxy, &proxies.ports()) else {
            return Vec::new();
        };
        // How the worker finds its own proxy. macOS reaches it over loopback,
        // on the one port the profile allows out. Linux has no route to the
        // supervisor, only this Agent's socket bound into its namespace, and
        // the worker runs a bridge from its own loopback to that socket so
        // every command can keep using an ordinary `http://127.0.0.1:<port>`
        // proxy URL (ADR 0069).
        if cfg!(target_os = "linux") {
            command.push("--proxy-unix".to_string());
            command.push(sandbox::PROXY_SOCKET.to_string());
        } else {
            command.push("--proxy".to_string());
            command.push(proxy.url);
        }
        Sandbox::new(policy).wrap(&command)
    })
}

/// The rules one Agent's worker runs under, started from `bin` (ADR 0008,
/// 0069): its own folder to write in, the program's folder to read, and the one
/// way out, which is its own proxy. `proxy_ports` are every proxy on the
/// Machine, so the range this Agent may bind never covers one. `None` when this
/// system has no sandbox, or the Agent has no folder it can be given: then
/// nothing of that Agent runs.
pub fn rules(
    home: &Path,
    agent: &Agent,
    bin: &Path,
    proxy: &crate::proxy::ProxyView,
    proxy_ports: &[u16],
) -> Option<Policy> {
    if !sandbox::AVAILABLE {
        return None;
    }
    let dir = agent_dir(home, &agent.id).ok()?;
    let mut policy = Policy::new(&dir.join("workdir"), &dir.join("tmp"), bin);
    // The one way out on macOS: this Agent's own TCP listener, and no other.
    policy.proxy = Some(proxy.port);
    // The one way out on Linux: this Agent's socket, bound into its namespace
    // at a fixed path (ADR 0069). A system without one never reads it.
    policy.proxy_socket = proxy
        .socket
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    // The Agent's own localhost, from the range the supervisor reserved for it
    // and kept outside its folder (ADR 0069). The toolchain check runs under
    // these rules too, so it sees what the worker sees. A range that cannot be
    // read leaves the Agent without ports, never without a worker.
    policy.ports = crate::ports::Ports::open(home)
        .and_then(|ports| {
            ports.range_avoiding(&agent.id, &|port| proxy_ports.contains(&port))
        })
        .map(|range| range.ports())
        .unwrap_or_default();
    Some(policy)
}

/// The folder the program in `command` lives in, which must be readable for it
/// to start at all.
fn program_dir(command: &[String]) -> Option<PathBuf> {
    command
        .first()
        .and_then(|program| Path::new(program).parent())
        .map(Path::to_path_buf)
}

/// The Agent's own home, `<agent>/.home`: where `$HOME`, caches and its git
/// identity live, so nothing reads or writes the owner's (ADR 0069). The git
/// config is written once; the Agent may change it after.
fn agent_home(dir: &Path, agent: &Agent) -> std::io::Result<PathBuf> {
    let home = dir.join(".home");
    std::fs::create_dir_all(home.join(".cache"))?;
    let gitconfig = home.join(".gitconfig");
    if !gitconfig.exists() {
        std::fs::write(
            &gitconfig,
            format!(
                "[user]\n\tname = {}\n\temail = {}@agents.veeloe.invalid\n",
                agent.name.replace(['\n', '\\', '"'], " "),
                agent.id
            ),
        )?;
    }
    Ok(home)
}
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
    toolchains: Mutex<Option<Toolchains>>,
    /// The process id of each Agent's running worker, so a sandbox refusal in
    /// the system log can be tied back to the work that caused it (issue #37).
    pids: Mutex<HashMap<String, u32>>,
    reported: Reported,
    running: Mutex<HashMap<String, Entry>>,
    stopping: AtomicBool,
    /// The Task logs, which only this process writes (ADR 0069).
    logs: TaskLogs,
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
        let logs = TaskLogs::new(home.clone());
        Self {
            inner: Arc::new(Inner {
                home,
                command,
                llm,
                on_message,
                log,
                wrap,
                toolchains: Mutex::new(None),
                pids: Mutex::new(HashMap::new()),
                reported: Reported::default(),
                running: Mutex::new(HashMap::new()),
                stopping: AtomicBool::new(false),
                logs,
            }),
        }
    }

    /// Report the toolchains a worker cannot run as it opens, at Runtime log
    /// level (issue #35). Without it a worker still starts; nothing is reported.
    pub fn checking_toolchains(&self, check: Toolchains) {
        *self.inner.toolchains.lock().expect("toolchains") = Some(check);
    }

    /// Follow the macOS sandbox's own record, so a service the profile does not
    /// name shows up as a Runtime log line instead of a silent failure (issue
    /// #37). The handle must stay alive with the Runtime; dropping it stops the
    /// reader. `None` on a system whose sandbox keeps no such log.
    pub fn watching_denials(&self) -> Option<crate::denials::Denials> {
        let inner = Arc::clone(&self.inner);
        let running: crate::denials::Running = Arc::new(move || {
            inner
                .pids
                .lock()
                .expect("pids")
                .iter()
                .map(|(agent, pid)| (*pid, agent.clone()))
                .collect()
        });
        crate::denials::Denials::start(self.inner.home.clone(), running)
    }

    /// Starts this Agent's worker unless it is already running. An Agent in the
    /// trash gets none, even when boot asks for every Agent (`agent-trash`).
    pub fn start(&self, agent: &Agent) {
        if agent.deleted() {
            return;
        }
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

    /// Drop one Agent's worker. The worker ends when its channel closes; a
    /// Turn that was running is interrupted, as a stopped process is.
    pub fn stop(&self, id: &str) {
        self.inner.running.lock().expect("running").remove(id);
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
    let agent_home = match agent_home(&dir, agent) {
        Ok(home) => home,
        Err(error) => {
            return Ending {
                stopped: false,
                why: format!("could not make the Agent's home: {error}"),
            }
        }
    };
    // The log moves out of the Agent's writable folder the first time, and is
    // open here before the worker starts: the worker never opens it itself
    // (ADR 0069), so a missing log is a failure to start, not an empty history.
    if let Err(why) = inner.logs.prepare(&agent.id, &dir) {
        return Ending {
            stopped: false,
            why: format!("could not open the Task log: {why}"),
        };
    }
    let argv = (inner.wrap)(agent, inner.command.clone());
    let Some((program, rest)) = argv.split_first() else {
        return Ending {
            stopped: false,
            why: "no sandbox to run it in".into(),
        };
    };
    // The port range the wrap just reserved for this Agent, read back from the
    // file so a restart hands out the same one (ADR 0069). Every command sees
    // `PORT` and the whole list, so a dev server started by a Task keeps its
    // address across Turns and finds the database beside it. This reads only:
    // `rules()` is the one place that allocates, with every proxy's port
    // excluded, so a second allocation here could only reserve a worse range.
    let ports = match crate::ports::Ports::open(&inner.home) {
        Ok(ports) => ports.existing(&agent.id),
        Err(error) => {
            (inner.log)(&format!(
                "agent {} runs without localhost ports: {error}",
                agent.id
            ));
            None
        }
    };
    if ports.is_none() {
        (inner.log)(&format!(
            "agent {} runs without localhost ports: no range is reserved",
            agent.id
        ));
    }
    let mut command = Command::new(program);
    command.args(rest);
    command
        .env_clear()
        // Only what a worker needs. Never a Provider's key: the supervisor holds
        // that (ADR 0042).
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", &agent_home)
        .env("XDG_CACHE_HOME", agent_home.join(".cache"))
        .env("GIT_CONFIG_GLOBAL", agent_home.join(".gitconfig"))
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
        );
    if let Some(ports) = &ports {
        command
            .env("PORT", ports.start().to_string())
            .env("VEELOE_PORTS", ports.listed());
    }
    command
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
    let pid = child.id().unwrap_or_default();
    inner
        .pids
        .lock()
        .expect("pids")
        .insert(agent.id.clone(), pid);
    // The toolchains are checked beside the worker, not before it: a machine
    // whose `bun` is broken must still open a worker and end a Turn (issue #35).
    report_toolchains(inner, agent);
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
                        FromWorker::LogAppend { id, task, starter, kind, body, message_id } => {
                            match inner.logs.record(
                                &agent.id,
                                &task,
                                &starter,
                                &kind,
                                &body,
                                message_id.as_deref(),
                            ) {
                                Ok(event) => {
                                    write(&mut writing, &ToWorker::LogAppended { id, event })
                                        .await;
                                }
                                Err(code) => {
                                    (inner.log)(&format!(
                                        "could not write the Task log of agent {}: {code}",
                                        agent.id
                                    ));
                                    write(&mut writing, &ToWorker::LogFailed { id, code }).await;
                                }
                            }
                        }
                        FromWorker::LogRead { id, query } => {
                            match inner.logs.answer(&agent.id, &query) {
                                Ok(answer) => {
                                    write(&mut writing, &ToWorker::LogAnswer { id, answer }).await;
                                }
                                Err(code) => {
                                    write(&mut writing, &ToWorker::LogFailed { id, code }).await;
                                }
                            }
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
    inner.pids.lock().expect("pids").remove(&agent.id);
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

/// Start the check in the background and write what it finds, or nothing when
/// this Runtime has no check or no rules to check under. Its own thread, because
/// a tool that hangs is bounded by a timeout, not by the worker's readiness.
fn report_toolchains(inner: &Arc<Inner>, agent: &Agent) {
    let check = inner.toolchains.lock().expect("toolchains").clone();
    let (Some(check), Some(bin)) = (check, program_dir(&inner.command)) else {
        return;
    };
    let inner = Arc::clone(inner);
    let agent = agent.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(reports) = check(&agent, &bin) {
            inner.reported.record(&inner.home, &agent.id, &reports);
        }
    });
}
