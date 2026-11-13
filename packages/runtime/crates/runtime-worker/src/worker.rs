//! The worker process: one Agent, its Task log, its tools, and the LLM reached
//! through the supervisor. Ported from `packages/runtime-legacy/src/worker/index.ts`.
//!
//! It talks to the supervisor over IPC only, its LLM requests included, and
//! ends when the supervisor does (ADR 0020, 0008).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::oneshot;
use veeloe_plugin_api::{Cancel, ToolRegistry};
use veeloe_runtime_core::sandbox::Sandbox;
use veeloe_runtime_core::{
    AgentCore, AgentError, EventLog, FromWorker, LlmError, LlmHttpRequest, LlmHttpResponse,
    LogAnswer, LogQuery, StoreError, SupervisorLink, TaskEvent, TaskSummary, ToWorker,
};

use crate::llm::{AnthropicLlm, LlmTransport};
use crate::tools::bash::BashTool;
use crate::tools::files::FileTools;
use crate::tools::memory::MemoryTool;

/// Where a worker keeps everything it owns, and what it calls itself.
#[derive(Debug, Clone)]
pub struct Config {
    /// The Agent's folder: its `workdir` and its `tmp` live here. Its Task log
    /// does not: the supervisor owns that file (ADR 0069).
    pub dir: PathBuf,
    pub name: String,
    pub allowlist: Vec<String>,
    pub approval_timeout_ms: Option<u64>,
    /// What a command may see: the supervisor's environment, minus its own channels.
    pub env: HashMap<String, String>,
    /// The Machine's Egress when this worker started: the only domains a
    /// command may reach (ADR 0029).
    pub egress: Vec<String>,
    /// The local proxy every command reaches the network through, as a URL.
    pub proxy: Option<String>,
    /// How long one "second" of a bash timeout really is: 1000 in production, 20 in tests.
    pub second_ms: u64,
}

impl Config {
    pub fn new(dir: impl Into<PathBuf>, name: impl Into<String>) -> Self {
        Self {
            dir: dir.into(),
            name: name.into(),
            allowlist: Vec::new(),
            approval_timeout_ms: None,
            env: HashMap::new(),
            egress: Vec::new(),
            proxy: None,
            second_ms: 1_000,
        }
    }
}

/// The LLM over the IPC: each request keeps the way to drop it, so a Stop ends
/// the wait now (ADR 0017).
pub struct IpcTransport {
    link: Arc<dyn SupervisorLink>,
    pending: Mutex<HashMap<String, oneshot::Sender<LlmHttpResponse>>>,
    next: AtomicU64,
}

impl IpcTransport {
    pub fn new(link: Arc<dyn SupervisorLink>) -> Self {
        Self {
            link,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(0),
        }
    }

    /// Takes one `llm.response`. An answer to a request the Stop already dropped
    /// is thrown away.
    pub fn receive(&self, answer: LlmHttpResponse, id: &str) -> bool {
        let waiter = self.pending.lock().expect("pending").remove(id);
        match waiter {
            Some(waiter) => waiter.send(answer).is_ok(),
            None => false,
        }
    }
}

#[async_trait]
impl LlmTransport for IpcTransport {
    async fn call(
        &self,
        request: LlmHttpRequest,
        cancel: &Cancel,
    ) -> Result<LlmHttpResponse, LlmError> {
        let id = (self.next.fetch_add(1, Ordering::SeqCst) + 1).to_string();
        let (answer, answered) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending")
            .insert(id.clone(), answer);
        self.link.send(FromWorker::LlmRequest {
            id: id.clone(),
            method: request.method,
            path: request.path,
            headers: request.headers,
            body: request.body,
        });
        let settle = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(LlmError::Failed("turn.stopped".into())),
            answer = answered => match answer {
                Ok(answer) => Ok(answer),
                Err(_) => Err(LlmError::Failed("provider.failed".into())),
            },
        };
        if settle.is_err() {
            self.pending.lock().expect("pending").remove(&id);
        }
        settle
    }
}

pub struct Worker {
    inner: Arc<Inner>,
}

/// How long one write or read waits for the supervisor's answer. The two
/// processes share a pipe, so this only trips when the supervisor is gone —
/// and then the Turn fails visibly instead of hanging.
///
/// The wait blocks the calling Tokio thread on purpose. The answer does not
/// need any task of this runtime to run: the supervisor is another process and
/// answers from its own select loop, and the dedicated stdin reader thread
/// (`entry.rs`) receives that answer and completes the channel from an ordinary
/// OS thread, not from a future. So the blocked thread is woken by the pipe
/// alone, and a `spawn_blocking` hop would add a task without changing when or
/// whether the wait ends. What it costs is one Tokio worker thread while the
/// Agent's Turn waits on the log, which is the wait the Turn is in anyway, and
/// the 30s bound keeps a missing supervisor from holding it forever.
const LOG_TIMEOUT: Duration = Duration::from_secs(30);

type Written = std::sync::mpsc::Sender<Result<TaskEvent, StoreError>>;
type Reading = std::sync::mpsc::Sender<Result<LogAnswer, StoreError>>;

/// The Task log seen from the worker: everything it writes and reads is a
/// request to the supervisor, which owns the file (ADR 0020, 0069). The log is
/// therefore not in this process's file system at all, so no command and no
/// tool can open it, let alone rewrite history.
pub struct IpcLog {
    link: Arc<dyn SupervisorLink>,
    written: Mutex<HashMap<String, Written>>,
    read: Mutex<HashMap<String, Reading>>,
    next: AtomicU64,
}

impl IpcLog {
    pub fn new(link: Arc<dyn SupervisorLink>) -> Self {
        Self {
            link,
            written: Mutex::new(HashMap::new()),
            read: Mutex::new(HashMap::new()),
            next: AtomicU64::new(0),
        }
    }

    fn request_id(&self) -> String {
        format!("log{}", self.next.fetch_add(1, Ordering::SeqCst) + 1)
    }

    /// The supervisor's answer to one append. False when nothing waits on it.
    pub fn written(&self, id: &str, answer: Result<TaskEvent, StoreError>) -> bool {
        let waiter = self.written.lock().expect("written").remove(id);
        match waiter {
            Some(waiter) => waiter.send(answer).is_ok(),
            None => false,
        }
    }

    /// The supervisor's answer to one read.
    pub fn answered(&self, id: &str, answer: Result<LogAnswer, StoreError>) -> bool {
        let waiter = self.read.lock().expect("read").remove(id);
        match waiter {
            Some(waiter) => waiter.send(answer).is_ok(),
            None => false,
        }
    }

    /// A refusal from the supervisor, for whichever request it names.
    pub fn refused(&self, id: &str, code: &str) {
        if !self.written(id, Err(StoreError::Refused(code.to_string()))) {
            self.answered(id, Err(StoreError::Refused(code.to_string())));
        }
    }

    fn ask(&self, query: LogQuery) -> Result<LogAnswer, StoreError> {
        let id = self.request_id();
        let (answer, answered) = std::sync::mpsc::channel();
        self.read.lock().expect("read").insert(id.clone(), answer);
        self.link.send(FromWorker::LogRead {
            id: id.clone(),
            query,
        });
        let settle = answered.recv_timeout(LOG_TIMEOUT);
        if settle.is_err() {
            self.read.lock().expect("read").remove(&id);
            return Err(StoreError::Refused("log.unavailable".into()));
        }
        settle.expect("checked above")
    }
}

impl EventLog for IpcLog {
    fn record(
        &self,
        task: &str,
        starter: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, StoreError> {
        let id = self.request_id();
        let (written, answer) = std::sync::mpsc::channel();
        self.written
            .lock()
            .expect("written")
            .insert(id.clone(), written);
        self.link.send(FromWorker::LogAppend {
            id: id.clone(),
            task: task.to_string(),
            starter: starter.to_string(),
            kind: kind.to_string(),
            body: body.clone(),
            message_id: message_id.map(str::to_string),
        });
        let settle = answer.recv_timeout(LOG_TIMEOUT);
        if settle.is_err() {
            self.written.lock().expect("written").remove(&id);
            return Err(StoreError::Refused("log.unavailable".into()));
        }
        settle.expect("checked above")
    }

    fn starter_of(&self, task: &str) -> Result<Option<String>, StoreError> {
        match self.ask(LogQuery::Starter {
            task: task.to_string(),
        })? {
            LogAnswer::Starter { starter } => Ok(starter),
            _ => Err(StoreError::Refused("log.answer".into())),
        }
    }

    fn has_message(&self, message_id: &str) -> Result<bool, StoreError> {
        match self.ask(LogQuery::HasMessage {
            id: message_id.to_string(),
        })? {
            LogAnswer::HasMessage { seen } => Ok(seen),
            _ => Err(StoreError::Refused("log.answer".into())),
        }
    }

    fn events(&self, task: &str, after: i64) -> Result<Vec<TaskEvent>, StoreError> {
        match self.ask(LogQuery::Events {
            task: task.to_string(),
            after,
        })? {
            LogAnswer::Events { events } => Ok(events),
            _ => Err(StoreError::Refused("log.answer".into())),
        }
    }

    fn tasks_started_by(&self, member: &str) -> Result<Vec<TaskSummary>, StoreError> {
        match self.ask(LogQuery::TasksStartedBy {
            member: member.to_string(),
        })? {
            LogAnswer::TasksStartedBy { tasks } => Ok(tasks),
            _ => Err(StoreError::Refused("log.answer".into())),
        }
    }

    fn open_turns(&self) -> Result<Vec<String>, StoreError> {
        match self.ask(LogQuery::OpenTurns)? {
            LogAnswer::OpenTurns { tasks } => Ok(tasks),
            _ => Err(StoreError::Refused("log.answer".into())),
        }
    }
}

struct Inner {
    core: AgentCore,
    transport: Arc<IpcTransport>,
    link: Arc<dyn SupervisorLink>,
    log: Arc<IpcLog>,
}

impl Clone for Worker {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl Worker {
    pub fn new(config: Config, link: Arc<dyn SupervisorLink>) -> Result<Self, AgentError> {
        let workdir = config.dir.join("workdir");
        // The supervisor started this worker inside the Agent's sandbox, and
        // every command it runs inherits it (ADR 0069).
        let sandbox = Sandbox::inherited();
        // A command reaches the network only through the proxy the supervisor
        // started; an inherited proxy variable could point somewhere else.
        let mut env = config.env.clone();
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        ] {
            env.remove(name);
        }
        if let Some(proxy) = &config.proxy {
            for name in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                env.insert(name.to_string(), proxy.clone());
            }
        }
        let mut tools = ToolRegistry::default();
        tools.register(Arc::new(BashTool::new(
            &workdir,
            env,
            config.second_ms,
            sandbox,
        )))?;
        tools.register(Arc::new(FileTools::new(&workdir, false)))?;
        tools.register(Arc::new(MemoryTool::new(&workdir)))?;

        let transport = Arc::new(IpcTransport::new(Arc::clone(&link)));
        let llm = Arc::new(AnthropicLlm::new(
            Arc::clone(&transport) as Arc<dyn LlmTransport>
        ));
        // The log is the supervisor's file; this process only asks for it
        // (ADR 0020, 0069).
        let log = Arc::new(IpcLog::new(Arc::clone(&link)));
        let workdir = config.dir.join("workdir");
        let core = AgentCore::over_log(
            config.name,
            Arc::clone(&log) as Arc<dyn EventLog>,
            llm,
            tools,
            Arc::clone(&link),
        )
        .with_workdir(workdir);
        if !config.allowlist.is_empty() {
            core.set_allowlist(config.allowlist);
        }
        if let Some(ms) = config.approval_timeout_ms {
            core.set_approval_timeout_ms(ms);
        }
        Ok(Self {
            inner: Arc::new(Inner {
                core,
                transport,
                link,
                log,
            }),
        })
    }

    /// Before taking work: whatever was running when this worker last ended is
    /// closed as interrupted, then the supervisor is told the worker is ready
    /// (ADR 0033).
    pub fn start(&self) -> Result<(), AgentError> {
        self.inner.core.close_open_turns()?;
        self.inner.link.send(FromWorker::Ready);
        Ok(())
    }

    pub fn receive(&self, message: ToWorker) -> Result<(), AgentError> {
        if self.reply(&message) {
            return Ok(());
        }
        self.inner.core.receive(message)
    }

    /// The answers this worker waits on — a Provider's reply, or the
    /// supervisor's word on one log request — belong to the task that asked,
    /// never to the Agent's loop. True when this was one of them.
    pub fn reply(&self, message: &ToWorker) -> bool {
        match message {
            ToWorker::LlmResponse {
                id,
                status,
                headers,
                body,
            } => {
                self.inner.transport.receive(
                    LlmHttpResponse {
                        status: *status,
                        headers: headers.clone(),
                        body: body.clone(),
                    },
                    id,
                );
                true
            }
            ToWorker::LogAppended { id, event } => {
                self.inner.log.written(id, Ok(event.clone()));
                true
            }
            ToWorker::LogFailed { id, code } => {
                self.inner.log.refused(id, code);
                true
            }
            ToWorker::LogAnswer { id, answer } => {
                self.inner.log.answered(id, Ok(answer.clone()));
                true
            }
            _ => false,
        }
    }

    pub async fn idle(&self) {
        self.inner.core.idle().await;
    }

    pub fn events(&self, task: &str) -> Result<Vec<veeloe_runtime_core::TaskEvent>, AgentError> {
        self.inner.core.events(task)
    }
}
