//! `veeloe`: the Runtime on this Machine (ADR 0020). One binary, two modes: the
//! supervisor, which starts each Agent's worker, and the commands that set it up.
//!
//! Ported from `packages/runtime-legacy/src/main.ts` and the wiring in
//! `supervisor/index.ts`. The sandbox (task 4.4) and self-update (4.5) are not
//! here yet: a worker is started directly.

mod cli {
    pub mod git;
    pub mod pair;
    pub mod prompt;
    pub mod provider;
}

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use serde_json::{json, Value};
use veeloe_protocol::envelope::{verify, Route};
use veeloe_protocol::hub_auth::normalize_hub_url;
use veeloe_runtime_core::ipc::LlmHttpRequest;
use veeloe_runtime_core::{FromWorker, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::AgentRegistry;
use veeloe_runtime_supervisor::approval::Approvals;
use veeloe_runtime_supervisor::doctor;
use veeloe_runtime_supervisor::egress::Egress;
use veeloe_runtime_supervisor::help::{help_for, USAGE};
use veeloe_runtime_supervisor::hub_link::{HubLink, HubLinkOptions, HubLinkSink, HubSender};
use veeloe_runtime_supervisor::llm::{HttpClient, LlmProxy};
use veeloe_runtime_supervisor::logs;
use veeloe_runtime_supervisor::memory;
use veeloe_runtime_supervisor::preflight;
use veeloe_runtime_supervisor::providers::{load_providers, upstream_headers};
use veeloe_runtime_supervisor::proxy::Proxies;
use veeloe_runtime_supervisor::push::{recipients, PushKind};
use veeloe_runtime_supervisor::service;
use veeloe_runtime_supervisor::status::{remove_pid_file, run_status, write_pid_file};
use veeloe_runtime_supervisor::task_log::turn_log;
use veeloe_runtime_supervisor::task_routes::TaskRoutes;
use veeloe_runtime_supervisor::tasks::{dispatch, forward, Inbound, Machine, MachineOutbox};
use veeloe_runtime_supervisor::triggers::{MachineTime, Round, Triggers};
use veeloe_runtime_supervisor::trust::{
    load_hub_url, load_or_create_machine_key, load_trust, supervisor_dir, Trust,
};
use veeloe_runtime_supervisor::uploads::Uploads;
use veeloe_runtime_supervisor::usage::UsageStore;
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

use cli::pair::{first_run, pair, unpair};
use cli::provider::provider;

/// The Runtime's folder is VEELOE_HOME (default ~/.veeloe), created owner-only.
fn runtime_home() -> PathBuf {
    if let Ok(home) = std::env::var("VEELOE_HOME") {
        return PathBuf::from(home);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".veeloe")
}

/// A fault the CLI reports as `veeloe: <message>`: 1 for something the operator
/// can fix, 2 for a command line that is not one (legacy `reporting`/`fail`).
#[derive(Debug)]
struct CliError {
    message: String,
    code: i32,
}

impl CliError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: 2,
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

impl From<Box<dyn std::error::Error>> for CliError {
    fn from(error: Box<dyn std::error::Error>) -> Self {
        Self {
            message: error.to_string(),
            code: 1,
        }
    }
}

impl From<std::io::Error> for CliError {
    fn from(error: std::io::Error) -> Self {
        Self {
            message: error.to_string(),
            code: 1,
        }
    }
}

impl From<String> for CliError {
    fn from(message: String) -> Self {
        Self { message, code: 1 }
    }
}

/// The worker: this same binary in its hidden `worker` mode, so a release is
/// still one file (ADR 0020).
fn worker_command() -> Vec<String> {
    match std::env::current_exe() {
        Ok(exe) => vec![exe.to_string_lossy().to_string(), "worker".to_string()],
        Err(_) => vec!["veeloe".to_string(), "worker".to_string()],
    }
}

/// The supervisor's LLM: the proxy, which holds the Provider key (ADR 0042).
struct ProxyLlm {
    proxy: LlmProxy,
}

#[async_trait::async_trait]
impl SupervisorLlm for ProxyLlm {
    async fn answer(&self, agent: &str, request: LlmHttpRequest) -> LlmHttpResponse {
        self.proxy.handle(agent, &request).await
    }
}

struct Supervisor {
    home: PathBuf,
    registry: AgentRegistry,
    trust: Mutex<Trust>,
    egress: Arc<Egress>,
    /// One listener per Agent (ADR 0029, issue #43).
    proxies: Arc<Proxies>,
    /// The domain Approvals those proxies wait on (issue #44).
    approvals: Arc<Approvals>,
    secret_key: [u8; 32],
    seen: Mutex<MemorySeen>,
    /// This Supervisor, so a message that needs the wire (a Provider's models)
    /// can be handled after `on_envelope` has returned.
    me: Weak<Supervisor>,
    budgets: Arc<veeloe_runtime_supervisor::usage::Budgets>,
    routes: Arc<TaskRoutes>,
    http: Arc<dyn HttpClient>,
    uploads: Uploads,
    push_tokens: Arc<veeloe_runtime_supervisor::push_tokens::PushTokens>,
    push: Arc<veeloe_runtime_supervisor::push::ExpoPush>,
    /// The signed Triggers and the rounds they start (issue #56).
    triggers: Arc<Triggers>,
    /// The id the Hub gave this connection (`hub.ready`). Envelopes are addressed
    /// to it, not to the key, so nothing can be verified before it is known.
    machine: Mutex<Option<String>>,
    outbox: Mutex<Option<Arc<MachineOutbox>>>,
    workers: OnceLock<Workers>,
}

/// The counters a connection reads before it trusts anything.
type MemorySeen = veeloe_protocol::envelope::MemorySeenSequences;

impl Supervisor {
    fn deliver(&self, agent: &str, message: FromWorker) {
        // The proxy learns the running Turn from these events, and an ended
        // Turn refuses what its proxy still waits on (issue #44).
        self.approvals.observe(agent, &message);
        self.log_turn(agent, &message);
        self.notify(agent, &message);
        let outbox = self.outbox.lock().expect("outbox");
        if let Some(outbox) = outbox.as_ref() {
            forward(outbox.as_ref(), agent, message);
        }
    }

    /// A Turn's end is written without its text: the reason and the error code
    /// are what tell a stuck Task from a finished one (ADR 0052).
    fn log_turn(&self, agent: &str, message: &FromWorker) {
        if let Some((level, fields)) = turn_log(agent, message) {
            let _ = logs::record(&self.home, level, "turn.ended", fields);
        }
    }

    /// Turn two worker events into a Generic Push; nothing else is sent (ADR 0044).
    fn notify(&self, agent: &str, message: &FromWorker) {
        let FromWorker::Event {
            task,
            starter,
            event,
        } = message
        else {
            return;
        };
        let (kind, approval) = match event.kind.as_str() {
            "approval.requested" => (
                PushKind::Approval,
                event
                    .body
                    .get("request")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ),
            "turn.ended" => (PushKind::TurnEnded, None),
            _ => return,
        };
        let tokens = recipients(
            &self.trust.lock().expect("trust"),
            &self.push_tokens.all(),
            kind,
            starter,
        );
        if tokens.is_empty() {
            return;
        }
        let push = Arc::clone(&self.push);
        let held = Arc::clone(&self.push_tokens);
        let home = self.home.clone();
        let agent = agent.to_string();
        let task = task.clone();
        tokio::spawn(async move {
            match push
                .send(&tokens, kind, &agent, &task, approval.as_deref())
                .await
            {
                Ok(tickets) => {
                    for ticket in tickets.into_iter().filter(|ticket| ticket.drop) {
                        let _ = held.remove_token(&ticket.token);
                    }
                }
                Err(code) => {
                    let _ = veeloe_runtime_supervisor::logs::record(
                        &home,
                        "warn",
                        "push.failed",
                        json!({ "code": code }),
                    );
                }
            }
        });
    }
}

impl Supervisor {
    /// One pass over every Trigger: run, skip or suspend what is due (issue #56).
    fn tick_triggers(&self) {
        let Some(workers) = self.workers.get() else {
            return;
        };
        let trust = self.trust.lock().expect("trust").clone();
        let now_ms = veeloe_runtime_supervisor::usage::now_ms();
        for record in self.triggers.all() {
            let agent = self.registry.get(&record.agent).ok().flatten();
            let now = veeloe_runtime_supervisor::triggers::Now {
                ms: now_ms as u64,
                // An Agent purged from the trash waits too: it has no rounds left.
                in_trash: agent.as_ref().is_none_or(|agent| agent.deleted()),
                allowed: trust.uses(&record.member, Some(&record.key)),
                busy: self.approvals.current_turn(&record.agent).is_some(),
                budget_spent: agent
                    .as_ref()
                    .is_some_and(|agent| self.budgets.exhausted(agent, now_ms).unwrap_or(true)),
            };
            let round = veeloe_runtime_supervisor::triggers::decide(&record, &now, &MachineTime);
            let (agent_id, id) = (record.agent.as_str(), record.id.as_str());
            let fields = |at: u64| json!({ "agent": agent_id, "trigger": id, "at": at });
            match round {
                Round::Wait => {}
                Round::Suspend => {
                    let _ = self
                        .triggers
                        .update(agent_id, id, |held| held.suspended = true);
                    let _ = logs::record(&self.home, "warn", "trigger.suspended", fields(now.ms));
                }
                Round::Skip { at, why } => {
                    let _ = self
                        .triggers
                        .update(agent_id, id, |held| held.last_run_at = Some(at));
                    let mut skipped = fields(at);
                    skipped["why"] = json!(why);
                    let _ = logs::record(&self.home, "info", "trigger.skipped", skipped);
                }
                Round::Run { at } => {
                    let start = || {
                        veeloe_runtime_supervisor::triggers::start_round(
                            workers,
                            &self.triggers,
                            &record,
                            at,
                        )
                    };
                    // Workers start when the Hub connects; with no Hub there may be
                    // none yet, and a round must not wait for the Hub (issue #56).
                    let started = start().or_else(|| {
                        if let Some(agent) = &agent {
                            workers.start(agent);
                        }
                        start()
                    });
                    if started.is_some() {
                        let _ = self
                            .triggers
                            .update(agent_id, id, |held| held.last_run_at = Some(at));
                        let _ = logs::record(&self.home, "info", "trigger.run", fields(at));
                    }
                }
            }
        }
    }
}

impl HubLinkSink for Supervisor {
    fn log(&self, line: &str) {
        println!("{line}");
    }

    fn on_ready(&self, machine: &str) {
        *self.machine.lock().expect("machine") = Some(machine.to_string());
        let _ = logs::record(
            &self.home,
            "info",
            "hub.connected",
            json!({ "machine": machine }),
        );
        println!("connected as machine {machine}");
        if let Some(workers) = self.workers.get() {
            // The trash is cleared on the clock the Machine has now, then only
            // Agents in use get a worker (`agent-trash`).
            if let Ok(purged) = self
                .registry
                .purge_expired(veeloe_runtime_supervisor::usage::now_ms())
            {
                if purged > 0 {
                    let _ = logs::record(
                        &self.home,
                        "warn",
                        "agent.purge",
                        json!({ "agents": purged }),
                    );
                }
            }
            for agent in self.registry.all().unwrap_or_default() {
                workers.start(&agent);
            }
        }
    }

    fn on_envelope(&self, value: Value, send: &HubSender) {
        let outbox = {
            let mut held = self.outbox.lock().expect("outbox");
            if held.is_none() {
                *held = MachineOutbox::new(&self.home, &self.secret_key, send.clone())
                    .ok()
                    .map(Arc::new);
            }
            held.clone()
        };
        let Some(outbox) = outbox else { return };
        let Some(machine) = self.machine.lock().expect("machine").clone() else {
            return;
        };
        let mut seen = self.seen.lock().expect("seen");
        let trusted = self.trust.lock().expect("trust").trusted_keys();
        let Ok(verified) = verify(
            &value,
            &trusted,
            |route| matches!(route, Route::To(to) if *to == machine),
            &mut *seen,
        ) else {
            return;
        };
        let from = Inbound {
            member: verified.signed.member.clone().unwrap_or_default(),
            key: value
                .get("from")
                .and_then(Value::as_str)
                .map(str::to_string),
            reference: value
                .get("sig")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            task: verified.signed.task.clone(),
            // Only what is kept to run later needs its envelope; a file chunk
            // is not copied for nothing.
            envelope: (verified.signed.type_ == "trigger.set").then(|| value.clone()),
        };
        let Some(me) = self.me.upgrade() else { return };
        let trust = me.trust.lock().expect("trust").clone();
        let type_ = verified.signed.type_.clone();
        let body = verified.signed.body.clone();
        // Off the link's own task: a Provider's models come over the wire, and
        // the next envelope must not wait for them.
        tokio::spawn(async move {
            let Some(workers) = me.workers.get() else {
                return;
            };
            // Providers are a file the owner changes with the CLI while this
            // supervisor runs, so each message reads them again (ADR 0042).
            let providers = load_providers(&me.home).unwrap_or_default();
            let machine = Machine {
                registry: &me.registry,
                workers,
                routes: Some(me.routes.as_ref()),
                secret_key: Some(&me.secret_key),
                uploads: Some(&me.uploads),
                push_tokens: Some(me.push_tokens.as_ref()),
                triggers: Some(me.triggers.as_ref()),
                providers: &providers,
                egress: Some(me.egress.as_ref()),
                trust: Some(&trust),
                proxies: Some(me.proxies.as_ref()),
                approvals: Some(me.approvals.as_ref()),
                budgets: Some(me.budgets.as_ref()),
                http: me.http.as_ref(),
            };
            dispatch(&machine, outbox.as_ref(), &from, &type_, &body).await;
        });
    }

    fn on_certificates(&self, certificates: Vec<Value>) {
        if certificates.is_empty() {
            return;
        }
        let mut held = self.trust.lock().expect("trust");
        let next =
            veeloe_runtime_supervisor::trust::apply_certificates(&held, &certificates, &|line| {
                println!("{line}")
            });
        if next == *held {
            return;
        }
        if let Err(error) = veeloe_runtime_supervisor::trust::save_trust(&self.home, &next) {
            println!("could not save trust: {error}");
            return;
        }
        let revoked = next.revoked_since(&held);
        if !revoked.is_empty() {
            if let Err(error) = self.push_tokens.remove_devices(&revoked) {
                println!("could not remove push tokens: {error}");
            }
            // A lost phone must not keep giving work (ADR 0031).
            if let Err(error) = self.triggers.suspend_keys(&revoked) {
                println!("could not suspend triggers: {error}");
            }
        }
        *held = next;
    }
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        // A command line that is not one shows what the command line could be;
        // a fault the operator can fix is only named (legacy `fail`/`reporting`).
        if error.code == 2 {
            eprintln!("veeloe: {error}\n{USAGE}\nrun veeloe --help");
        } else {
            eprintln!("veeloe: {error}");
        }
        std::process::exit(error.code);
    }
}

async fn run() -> Result<(), CliError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // A key in an argument stays in shell history and in `ps`, so it is refused
    // before anything else reads it (legacy `main.ts`).
    let key_argument = args.iter().find(|arg| {
        let flag = arg.trim_start_matches('-');
        ["key", "api-key", "token"]
            .iter()
            .any(|name| flag == *name || flag.starts_with(&format!("{name}=")))
    });
    if key_argument.is_some() {
        return Err(CliError::usage(
            "a Provider key is never an argument. Type it when asked, or pipe it in: veeloe provider add ... < key.txt",
        ));
    }
    let command = args
        .iter()
        .find(|arg| !arg.starts_with('-'))
        .map(String::as_str);
    // `veeloe --help`, `veeloe help <command>`: one command's text, or all of them.
    if args.iter().any(|arg| arg == "--help" || arg == "-h") || command == Some("help") {
        let topic = if command == Some("help") {
            args.iter()
                .skip(1)
                .find(|arg| !arg.starts_with('-'))
                .map(String::as_str)
        } else {
            command
        };
        let Some(text) = help_for(topic) else {
            return Err(CliError::usage(format!(
                "no command {}",
                topic.unwrap_or_default()
            )));
        };
        println!("{text}");
        return Ok(());
    }
    // The version the release stamped into Cargo.toml (runtime-release.yml).
    if command.is_none() && args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("veeloe {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    // Only a bare `veeloe` starts the supervisor: a stray flag must not start
    // a second one (issue #55).
    if command.is_none() {
        if let Some(flag) = args.first() {
            return Err(CliError::usage(format!("unknown flag: {flag}")));
        }
    }
    // A worker runs inside the Agent's sandbox, where `VEELOE_HOME` cannot be
    // read: it must not touch it before it knows it is a worker (ADR 0069).
    if command == Some("worker") {
        return veeloe_runtime_worker::entry::run_stdio()
            .await
            .map_err(CliError::from);
    }
    let home = runtime_home();
    std::fs::create_dir_all(&home)?;
    match command {
        None => supervisor(home).await.map_err(CliError::from),
        Some("pair") => pair(home, &args[1..]).await.map_err(CliError::from),
        Some("unpair") => unpair(home).map_err(CliError::from),
        Some("status") => {
            run_status(&home, &mut |line| println!("{line}"));
            Ok(())
        }
        Some("logs") => {
            logs::run(&home, args.iter().any(|arg| arg == "--follow")).map_err(CliError::from)
        }
        Some("memory") => match args.get(1) {
            Some(query) => {
                memory::run(&home, query, &mut |line| println!("{line}")).map_err(|error| {
                    CliError {
                        message: error.to_string(),
                        code: if error.is_usage() { 2 } else { 1 },
                    }
                })
            }
            None => Err(CliError::usage("which Agent? veeloe memory <agent>")),
        },
        Some("service") => match args.get(1).map(String::as_str) {
            Some("install") => service::install(&home).map_err(CliError::from),
            Some("uninstall") => service::uninstall(&home).map_err(CliError::from),
            _ => Err(CliError::usage(
                "not a service command: see veeloe help service",
            )),
        },
        Some("doctor") => {
            // The only fix `doctor` has is the AppArmor profile (issue #49);
            // what it needs from the Machine is injected, so a test runs it
            // on macOS without root or AppArmor.
            if args.len() != 2 || args[1] != "--fix-apparmor" {
                return Err(CliError::usage(
                    "what should doctor fix? veeloe doctor --fix-apparmor",
                ));
            }
            for line in doctor::fix_apparmor(&doctor::SystemHost).map_err(CliError::from)? {
                println!("{line}");
            }
            Ok(())
        }
        Some("provider") => {
            match args.get(1).map(String::as_str) {
                Some("add") | Some("list") | Some("remove") => {
                    provider(home, &args[1..]).await.map_err(CliError::from)
                }
                // Never the arguments themselves: a key pasted in the wrong
                // place would be printed (legacy `main.ts`).
                Some(_) | None => Err(CliError::usage(
                    "not a provider command (a key is never an argument): see veeloe help provider",
                )),
            }
        }
        Some("git") => cli::git::git(home, &args[1..]).map_err(CliError::from),
        Some(other) => Err(CliError::usage(format!("unknown command: {other}"))),
    }
}

async fn supervisor(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    if !first_run(&home).await? {
        std::process::exit(1);
    }
    if load_providers(&home).unwrap_or_default().is_empty() {
        println!("no Provider yet, so no Agent can answer. Add one with: veeloe provider add");
    }
    let hub = load_hub_url(&home).ok_or("no Hub URL: run veeloe pair --hub <url>")?;
    let hub = normalize_hub_url(&hub).map_err(|_| "the Hub URL is not a websocket URL")?;
    // A Machine that cannot make the sandbox gets no Hub link and no worker:
    // say what is missing, and how to fix it, before anything starts (issue
    // #46). `worker` mode is already inside the sandbox, so it never checks.
    preflight::check_this_system().map_err(CliError::from)?;
    let secret_key = load_or_create_machine_key(&home)?;
    let registry = AgentRegistry::open(&home)?;
    let trust = load_trust(&home)?;
    if trust.owners.is_empty() {
        return Err("this Machine is not paired: run veeloe pair".into());
    }
    let _ = logs::record(&home, "info", "runtime.start", json!({}));
    let egress = Arc::new(Egress::open(&home)?);
    // One Task log, written by the supervisor only (ADR 0069), shared with the
    // domain Approvals so a proxy's request lands in the Turn that caused it
    // (issue #44).
    let task_logs = Arc::new(veeloe_runtime_supervisor::task_log::TaskLogs::new(
        home.clone(),
    ));
    let approvals = Arc::new(Approvals::new(
        home.clone(),
        Arc::clone(&egress),
        Arc::clone(&task_logs),
    ));
    // Every command reaches the network only through its own Agent's proxy,
    // which checks that Agent's Egress on each connection; Seatbelt cannot match
    // a domain itself (ADR 0008, 0029, 0069). One listener per Agent, each on a
    // port outside every range a command may bind.
    let reserved = veeloe_runtime_supervisor::ports::Ports::open(&home)
        .map_err(|error| format!("cannot open the Agents' ports folder: {error}"))?;
    // A corrupt `ports.json` is read as empty, not a reason to refuse to start:
    // every Agent would go down with one bad file. The Runtime log already
    // holds the reason; this is the line the operator sees.
    if let Some(reason) = reserved.warning() {
        eprintln!(
            "veeloe: the Agents' ports file could not be read, so none are reserved: {reason}"
        );
        eprintln!("veeloe: the next Agent that starts writes a fresh one.");
    }
    let proxies = Arc::new(Proxies::with_approvals(
        home.clone(),
        Arc::clone(&egress),
        Some(Arc::clone(&approvals)),
    ));
    for agent in registry.all().unwrap_or_default() {
        // An Agent in the trash has no worker, so it needs no listener either.
        if agent.deleted() {
            continue;
        }
        if let Err(error) = proxies.ensure(&agent.id).await {
            eprintln!(
                "veeloe: agent {} has no proxy, so its worker will not start: {error}",
                agent.id
            );
        }
    }
    let budgets = Arc::new(veeloe_runtime_supervisor::usage::Budgets::new(
        UsageStore::open(&supervisor_dir(&home)?.join("usage.db"))?,
    ));
    let routes = Arc::new(TaskRoutes::open(&home)?);
    let agent_ids: Vec<String> = registry
        .all()
        .unwrap_or_default()
        .into_iter()
        .map(|agent| agent.id)
        .collect();
    routes.prune(&agent_ids)?;

    let http: Arc<dyn HttpClient> = Arc::new(ReqwestClient::new());
    let push_tokens = Arc::new(veeloe_runtime_supervisor::push_tokens::PushTokens::open(
        &home,
    )?);
    let push = Arc::new(veeloe_runtime_supervisor::push::ExpoPush::new(Arc::clone(
        &http,
    )));
    let triggers = Arc::new(Triggers::open(&home)?);
    let supervisor = Arc::new_cyclic(|me| Supervisor {
        home: home.clone(),
        registry,
        trust: Mutex::new(trust),
        egress,
        proxies: Arc::clone(&proxies),
        approvals: Arc::clone(&approvals),
        secret_key,
        seen: Mutex::new(MemorySeen::default()),
        me: me.clone(),
        budgets: Arc::clone(&budgets),
        routes: Arc::clone(&routes),
        http: Arc::clone(&http),
        uploads: Uploads::default(),
        push_tokens,
        push,
        triggers: Arc::clone(&triggers),
        machine: Mutex::new(None),
        outbox: Mutex::new(None),
        workers: OnceLock::new(),
    });

    let routing = Arc::clone(&supervisor);
    let allow_budgets = Arc::clone(&budgets);
    let allow_routing = Arc::clone(&supervisor);
    let usage_budgets = Arc::clone(&budgets);
    let usage_routing = Arc::clone(&supervisor);
    let proxy = LlmProxy::new(http)
        .allow(move |agent| {
            let Ok(Some(agent)) = allow_routing.registry.get(agent) else {
                return false;
            };
            if agent.deleted() {
                return false;
            }
            !allow_budgets
                .exhausted(&agent, veeloe_runtime_supervisor::usage::now_ms())
                .unwrap_or(true)
        })
        .on_usage(move |agent, task, tokens| {
            let Ok(Some(agent)) = usage_routing.registry.get(agent) else {
                return;
            };
            let task = task.unwrap_or("");
            let Ok(usage) = usage_budgets.add_from(
                &agent,
                veeloe_runtime_supervisor::usage::now_ms(),
                &usage_routing.triggers.source_of(task),
                task,
                tokens,
            ) else {
                return;
            };
            let members: Vec<String> = usage_routing
                .trust
                .lock()
                .expect("trust")
                .owners
                .iter()
                .map(|owner| owner.member.clone())
                .collect();
            if let Some(outbox) = usage_routing.outbox.lock().expect("outbox").as_ref() {
                veeloe_runtime_supervisor::tasks::tell_usage(
                    outbox.as_ref(),
                    &members,
                    &agent,
                    &usage,
                );
            }
        })
        .route({
            let home = home.clone();
            move |agent, task| {
                let agent = routing.registry.get(agent).ok().flatten()?;
                let providers = load_providers(&home).unwrap_or_default();
                Some(match routes.route(&agent, task, &providers) {
                    Some((provider, model)) => veeloe_runtime_supervisor::llm::Route::Ready(
                        veeloe_runtime_supervisor::llm::Target {
                            url: provider.url.clone(),
                            model,
                            headers: upstream_headers(&provider, task),
                            web_search: provider.preset.as_deref() == Some("anthropic"),
                        },
                    ),
                    None => veeloe_runtime_supervisor::llm::Route::Missing,
                })
            }
        });
    let llm: Arc<dyn SupervisorLlm> = Arc::new(ProxyLlm { proxy });

    let weak = Arc::downgrade(&supervisor);
    // A domain Approval reaches the Member the same way a worker's event does,
    // so the Controller already knows how to draw it (issue #44).
    {
        let weak = weak.clone();
        approvals.delivering(Arc::new(move |agent: &str, message: FromWorker| {
            if let Some(supervisor) = weak.upgrade() {
                supervisor.deliver(agent, message);
            }
        }));
    }
    // The worker runs inside its Agent's sandbox, and every command it starts
    // inherits it (ADR 0008, 0069). It reaches the network only through that
    // Agent's own proxy. A worker that cannot be wrapped — or has no proxy —
    // is not started: an empty argv ends its session before it runs.
    let wrap = veeloe_runtime_supervisor::workers::sandboxed(home.clone(), Arc::clone(&proxies));
    // What one worker may use, from `config.json` and its defaults (issue #47).
    let limits = veeloe_runtime_supervisor::limits::load(&home);
    let workers = Workers::with_logs(
        home.clone(),
        worker_command(),
        llm,
        Arc::new(move |agent: &str, message: FromWorker| {
            if let Some(supervisor) = weak.upgrade() {
                supervisor.deliver(agent, message);
            }
        }),
        Arc::new(|line| println!("{line}")),
        wrap,
        task_logs,
    );
    workers.limiting(limits);
    {
        let approvals = Arc::clone(&approvals);
        workers.watching_session_end(Arc::new(move |agent: &str| {
            approvals.forget_agent(agent);
        }));
    }
    {
        let approvals = Arc::clone(&approvals);
        workers.watching_turns(Arc::new(move |agent: &str, task: &str, event| {
            approvals.observe_event(agent, task, event);
        }));
    }
    // Which toolchains a worker cannot run, checked under the same rules and
    // recorded at Runtime log level when it opens. It never stops a worker or
    // ends a Turn: the report is what the Owner fixes the Machine with (#35).
    {
        let home = home.clone();
        let proxies = Arc::clone(&proxies);
        workers.checking_toolchains(Arc::new(move |agent, bin| {
            // The same rules the worker got, including its own proxy and the
            // ports no range may cover (issue #43).
            let proxy = proxies.get(&agent.id)?;
            let policy = veeloe_runtime_supervisor::workers::rules(
                &home,
                agent,
                bin,
                &proxy,
                &proxies.ports(),
            )?;
            Some(veeloe_runtime_supervisor::toolchain::check(
                &policy,
                &std::env::var("PATH").unwrap_or_default(),
            ))
        }));
    }
    let _ = supervisor.workers.set(workers);
    // Rounds are counted on this Machine, with or without a Hub (issue #56).
    // ponytail: a 30-second tick, so a round starts up to 30 s late.
    {
        let rounds = Arc::clone(&supervisor);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                tick.tick().await;
                rounds.tick_triggers();
            }
        });
    }
    // The sandbox keeps no log of its own that a process can read: a refusal
    // goes to the system log, and this reader turns one into a Runtime log line
    // naming the service, so a missing name is added from evidence (issue #37).
    let denials = supervisor
        .workers
        .get()
        .and_then(|workers| workers.watching_denials());

    let link = HubLink::start(
        HubLinkOptions {
            hub_url: hub,
            secret_key,
            base_ms: 500,
            cap_ms: 30_000,
        },
        Arc::clone(&supervisor) as Arc<dyn HubLinkSink>,
    );
    // `veeloe status` tells whether this one is running by this file and the
    // process behind it (legacy `writePidFile`).
    write_pid_file(&home)?;
    // Runs until the process is stopped.
    tokio::signal::ctrl_c().await?;
    remove_pid_file(&home);
    link.stop().await;
    if let Some(workers) = supervisor.workers.get() {
        workers.stop_all();
    }
    proxies.stop_all();
    drop(denials);
    Ok(())
}

/// The Provider's answer, read whole (ADR 0042).
struct ReqwestClient {
    client: reqwest::Client,
}

impl ReqwestClient {
    fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// A client for one CLI call: ten seconds, as the legacy `listModels` timed out.
    fn cli() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait::async_trait]
impl veeloe_runtime_supervisor::llm::HttpClient for ReqwestClient {
    async fn get(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
    ) -> Result<veeloe_runtime_supervisor::llm::HttpAnswer, String> {
        let mut request = self.client.get(url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let answer = request.send().await.map_err(|error| error.to_string())?;
        let status = answer.status().as_u16();
        let headers = answer
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let body = answer.text().await.map_err(|error| error.to_string())?;
        Ok(veeloe_runtime_supervisor::llm::HttpAnswer {
            status,
            headers,
            body,
        })
    }

    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<veeloe_runtime_supervisor::llm::HttpAnswer, String> {
        let mut request = self.client.post(url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let answer = request
            .body(body)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = answer.status().as_u16();
        let headers = answer
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let body = answer.text().await.map_err(|error| error.to_string())?;
        Ok(veeloe_runtime_supervisor::llm::HttpAnswer {
            status,
            headers,
            body,
        })
    }
}
