//! The worker process: one Agent, its Task log, its tools, and the LLM reached
//! through the supervisor. Ported from `packages/runtime-legacy/src/worker/index.ts`.
//!
//! It talks to the supervisor over IPC only, its LLM requests included, and
//! ends when the supervisor does (ADR 0020, 0008).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::sync::oneshot;
use veeloe_plugin_api::{Cancel, ToolRegistry};
use veeloe_runtime_core::sandbox::{Policy, Sandbox};
use veeloe_runtime_core::{
    AgentCore, AgentError, EventStore, FromWorker, LlmError, LlmHttpRequest, LlmHttpResponse,
    SupervisorLink, ToWorker,
};

use crate::llm::{AnthropicLlm, LlmTransport};
use crate::tools::bash::BashTool;
use crate::tools::files::FileTools;

/// Where a worker keeps everything it owns, and what it calls itself.
#[derive(Debug, Clone)]
pub struct Config {
    /// The Agent's folder: `tasks.db` and `workdir` live here.
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
    /// The rules every command this Agent runs is under: its own folder is the
    /// only place it may write, the owner's home is not readable, and only the
    /// Machine's Egress gets out (ADR 0008, 0029).
    pub fn sandbox(&self) -> Sandbox {
        let home = self
            .env
            .get("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let bin = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("/usr/bin"));
        // `dir` is `<runtime_home>/agents/<id>`, so two levels up is the folder
        // holding the Machine key and every other Agent's folder.
        let runtime_home = self
            .dir
            .parent()
            .and_then(Path::parent)
            .unwrap_or(&self.dir);
        let mut policy = Policy::new(
            &self.dir.join("workdir"),
            &self.dir.join("tmp"),
            &bin,
            self.egress.clone(),
            &home,
            runtime_home,
        );
        policy.proxy = self
            .proxy
            .as_deref()
            .and_then(|url| url.rsplit_once(':'))
            .and_then(|(_, port)| port.parse().ok());
        Sandbox::new(policy)
    }

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

struct Inner {
    core: AgentCore,
    transport: Arc<IpcTransport>,
    link: Arc<dyn SupervisorLink>,
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
        let sandbox = config.sandbox();
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

        let transport = Arc::new(IpcTransport::new(Arc::clone(&link)));
        let llm = Arc::new(AnthropicLlm::new(
            Arc::clone(&transport) as Arc<dyn LlmTransport>
        ));
        let store = EventStore::open(config.dir.join("tasks.db"))?;
        let workdir = config.dir.join("workdir");
        let core = AgentCore::new(
            config.name,
            store,
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
        if let ToWorker::LlmResponse {
            id,
            status,
            headers,
            body,
        } = message
        {
            self.inner
                .transport
                .receive(LlmHttpResponse { status, headers, body }, &id);
            return Ok(());
        }
        self.inner.core.receive(message)
    }

    pub async fn idle(&self) {
        self.inner.core.idle().await;
    }

    pub fn events(&self, task: &str) -> Result<Vec<veeloe_runtime_core::TaskEvent>, AgentError> {
        self.inner.core.events(task)
    }
}
