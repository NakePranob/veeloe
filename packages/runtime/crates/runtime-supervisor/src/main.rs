//! `veeloe`: the Runtime on this Machine (ADR 0020). One binary, two modes: the
//! supervisor, which starts each Agent's worker, and the commands that set it up.
//!
//! Ported from `packages/runtime-legacy/src/main.ts` and the wiring in
//! `supervisor/index.ts`. The sandbox (task 4.4) and self-update (4.5) are not
//! here yet: a worker is started directly.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use serde_json::{json, Value};
use veeloe_protocol::envelope::{verify, Route};
use veeloe_protocol::hub_auth::normalize_hub_url;
use veeloe_protocol::pairing::PAIRING_TTL_SECONDS;
use veeloe_runtime_core::ipc::LlmHttpRequest;
use veeloe_runtime_core::{FromWorker, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::AgentRegistry;
use veeloe_runtime_supervisor::egress::{is_valid_egress, Egress};
use veeloe_runtime_supervisor::help::{help_for, USAGE};
use veeloe_runtime_supervisor::hub_link::{HubLink, HubLinkOptions, HubLinkSink, HubSender};
use veeloe_runtime_supervisor::llm::{HttpClient, LlmProxy};
use veeloe_runtime_supervisor::logs;
use veeloe_runtime_supervisor::models;
use veeloe_runtime_supervisor::pair::{run_pair, PairOptions, PairResult};
use veeloe_runtime_supervisor::providers::{load_providers, upstream_headers};
use veeloe_runtime_supervisor::service;
use veeloe_runtime_supervisor::status::{remove_pid_file, run_status, write_pid_file};
use veeloe_runtime_supervisor::tasks::{
    agents_listed, dispatch, forward, Inbound, Machine, MachineOutbox, Outbox,
};
use veeloe_runtime_supervisor::task_routes::TaskRoutes;
use veeloe_runtime_supervisor::trust::{
    load_hub_url, load_or_create_machine_key, load_trust, supervisor_dir, Trust,
};
use veeloe_runtime_supervisor::usage::UsageStore;
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

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
    secret_key: [u8; 32],
    seen: Mutex<MemorySeen>,
    /// This Supervisor, so a message that needs the wire (a Provider's models)
    /// can be handled after `on_envelope` has returned.
    me: Weak<Supervisor>,
    budgets: Arc<veeloe_runtime_supervisor::usage::Budgets>,
    routes: Arc<TaskRoutes>,
    http: Arc<dyn HttpClient>,
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
        let outbox = self.outbox.lock().expect("outbox");
        if let Some(outbox) = outbox.as_ref() {
            forward(outbox.as_ref(), agent, message);
        }
    }
}

impl HubLinkSink for Supervisor {
    fn log(&self, line: &str) {
        println!("{line}");
    }

    fn on_ready(&self, machine: &str) {
        *self.machine.lock().expect("machine") = Some(machine.to_string());
        let _ = logs::record(&self.home, "info", "hub.connected", json!({ "machine": machine }));
        println!("connected as machine {machine}");
        if let Some(workers) = self.workers.get() {
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
            reference: value
                .get("sig")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            task: verified.signed.task.clone(),
        };
        if verified.signed.type_ == "egress.set" {
            let Some(domains) = verified
                .signed
                .body
                .get("egress")
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| entry.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
            else {
                return;
            };
            let Some(me) = self.me.upgrade() else { return };
            let outbox = Arc::clone(&outbox);
            // The list is checked before it is applied, and every Member hears
            // the new one; a running worker is told without a restart (ADR 0029).
            tokio::spawn(async move {
                if !is_valid_egress(&domains) {
                    outbox.error(&from, "egress.invalid_domain");
                    return;
                }
                let _ = me.egress.set(domains.clone());
                let providers = load_providers(&me.home).unwrap_or_default();
                let providers = models::info(&providers, me.http.as_ref()).await;
                outbox.to_member(
                    &from.member,
                    "agent.listed",
                    agents_listed(&me.registry, &providers, &domains),
                    None,
                );
            });
            return;
        }
        let Some(me) = self.me.upgrade() else { return };
        let egress = me.egress.current();
        let type_ = verified.signed.type_.clone();
        let body = verified.signed.body.clone();
        // Off the link's own task: a Provider's models come over the wire, and
        // the next envelope must not wait for them.
        tokio::spawn(async move {
            let Some(workers) = me.workers.get() else { return };
            // Providers are a file the owner changes with the CLI while this
            // supervisor runs, so each message reads them again (ADR 0042).
            let providers = load_providers(&me.home).unwrap_or_default();
            let machine = Machine {
                registry: &me.registry,
                workers,
                routes: Some(me.routes.as_ref()),
                providers: &providers,
                egress: &egress,
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
        let next = veeloe_runtime_supervisor::trust::apply_certificates(
            &held,
            &certificates,
            &|line| println!("{line}"),
        );
        if next == *held {
            return;
        }
        if let Err(error) = veeloe_runtime_supervisor::trust::save_trust(&self.home, &next) {
            println!("could not save trust: {error}");
            return;
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
    let home = runtime_home();
    std::fs::create_dir_all(&home)?;
    match command {
        None => supervisor(home).await.map_err(CliError::from),
        Some("pair") => pair(home, &args[1..]).await.map_err(CliError::from),
        Some("unpair") => unpair(home).map_err(CliError::from),
        Some("worker") => veeloe_runtime_worker::entry::run_stdio()
            .await
            .map_err(CliError::from),
        Some("status") => {
            run_status(&home, &mut |line| println!("{line}"));
            Ok(())
        }
        Some("logs") => logs::run(&home, args.iter().any(|arg| arg == "--follow")).map_err(CliError::from),
        Some("service") => match args.get(1).map(String::as_str) {
            Some("install") => service::install(&home).map_err(CliError::from),
            Some("uninstall") => service::uninstall(&home).map_err(CliError::from),
            _ => Err(CliError::usage("not a service command: see veeloe help service")),
        },
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
        Some(other) => Err(CliError::usage(format!("unknown command: {other}"))),
    }
}

/// `unpair`: starts this Machine over, as the legacy CLI did (ADR 0031).
///
/// The key goes too: the Hub keeps the old one in the old Workspace and would
/// answer `hub.machine_taken` forever. The Agents and the Egress are forgotten
/// with it, so a new Workspace starts from nothing. The Hub URL stays, because
/// it is where the next `pair` would go.
///
/// Only a person at a terminal may do this, and only with a `y`; a closed stdin
/// or anything else changes nothing, exactly as `askOnTerminal` did.
fn unpair(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    // The question is asked even with no terminal: a closed stdin is a no, and a
    // no exits 1 (legacy `askOnTerminal` + `runUnpairCommand`).
    let answer = ask_line(
        "This Machine will stop trusting every Controller and get a new key. Continue? [y/N] ",
    )?;
    let yes = answer.map(|answer| answer.to_lowercase() == "y").unwrap_or(false);
    if !yes {
        println!("nothing was changed");
        std::process::exit(1);
    }

    let dir = supervisor_dir(&home)?;
    for file in ["trust.json", "seen.json", "agents.json", "egress.json"] {
        let _ = std::fs::remove_file(dir.join(file));
    }
    let _ = std::fs::remove_file(home.join("machine.key"));
    println!("unpaired. To pair again, run: veeloe pair");
    Ok(())
}

/// The Hub to pair with, as the legacy CLI took it: `pair --hub <url>`.
/// A bare URL and `--hub=<url>` are accepted too, because both are what an
/// operator copies out of a chat window.
fn hub_argument(args: &[String]) -> Option<String> {
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if let Some(url) = arg.strip_prefix("--hub=") {
            return Some(url.to_string());
        }
        if arg == "--hub" {
            return rest.next().cloned();
        }
        if !arg.starts_with('-') {
            return Some(arg.clone());
        }
    }
    None
}

/// Whether a person is at a terminal to answer; only then does any command ask
/// (legacy `interactive()`).
fn interactive() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

/// One line from the terminal, or `None` when stdin closes first (legacy
/// `askLine`).
fn ask_line(question: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
    use std::io::Write;
    print!("{question}");
    std::io::stdout().flush()?;
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line)? == 0 {
        return Ok(None);
    }
    Ok(Some(line.trim_end_matches(['\n', '\r']).trim().to_string()))
}

/// Asks until `check` takes the answer, or stdin closes (legacy `askValid`).
fn ask_valid<T>(
    question: &str,
    check: impl Fn(&str) -> Result<T, String>,
) -> Result<T, Box<dyn std::error::Error>> {
    loop {
        let Some(answer) = ask_line(question)? else {
            return Err("cancelled, nothing was saved".into());
        };
        match check(&answer) {
            Ok(value) => return Ok(value),
            Err(problem) => println!("{problem}"),
        }
    }
}

/// A numbered pick, asked again until it is one of them; `None` when stdin
/// closes (legacy `choose`).
fn choose(title: &str, labels: &[String]) -> Result<Option<usize>, Box<dyn std::error::Error>> {
    println!("{title}");
    for (at, label) in labels.iter().enumerate() {
        println!("  {}) {label}", at + 1);
    }
    loop {
        let Some(answer) = ask_line(&format!("Choose 1-{}: ", labels.len()))? else {
            return Ok(None);
        };
        if let Ok(picked) = answer.parse::<usize>() {
            if picked >= 1 && picked <= labels.len() {
                return Ok(Some(picked - 1));
            }
        }
    }
}

/// What one keypress does to an arrow pick: move to `at`, pick it, or cancel
/// (legacy `pickKey`).
enum Pick {
    At(usize),
    Picked(usize),
    Cancel,
}

fn pick_key(key: &str, at: usize, count: usize) -> Pick {
    match key {
        "\u{1b}[A" | "k" => Pick::At((at + count - 1) % count),
        "\u{1b}[B" | "j" => Pick::At((at + 1) % count),
        "\r" | "\n" => Pick::Picked(at),
        "\u{3}" | "\u{1b}" | "q" => Pick::Cancel,
        _ => match key.parse::<usize>() {
            Ok(n) if n >= 1 && n <= count => Pick::Picked(n - 1),
            _ => Pick::At(at),
        },
    }
}

/// Raw mode for one pick, restored however it ends. False when this stdin is
/// not a terminal that can be put in it.
fn raw_mode(enable: bool, saved: &mut Option<libc::termios>) -> bool {
    unsafe {
        if enable {
            let mut term: libc::termios = std::mem::zeroed();
            if libc::tcgetattr(0, &mut term) != 0 {
                return false;
            }
            *saved = Some(term);
            let mut raw = term;
            raw.c_lflag &= !(libc::ICANON | libc::ECHO);
            raw.c_cc[libc::VMIN] = 1;
            raw.c_cc[libc::VTIME] = 0;
            libc::tcsetattr(0, libc::TCSANOW, &raw) == 0
        } else {
            saved
                .map(|original| libc::tcsetattr(0, libc::TCSANOW, &original) == 0)
                .unwrap_or(false)
        }
    }
}

fn draw_pick(labels: &[String], at: usize, first: bool) {
    use std::io::Write;
    let mut out = std::io::stdout();
    if !first {
        let _ = write!(out, "\u{1b}[{}A", labels.len());
    }
    for (index, label) in labels.iter().enumerate() {
        let line = if index == at {
            format!("\u{1b}[2K\u{1b}[36m› {label}\u{1b}[0m\n")
        } else {
            format!("\u{1b}[2K  {label}\n")
        };
        let _ = out.write_all(line.as_bytes());
    }
    let _ = out.flush();
}

/// Pick one of `labels` with the arrow keys and Enter, or its number; Esc,
/// Ctrl-C and `q` cancel. Falls back to the numbered pick when stdin cannot go
/// into raw mode (legacy `pickWithArrows`).
fn pick_with_arrows(
    title: &str,
    labels: &[String],
) -> Result<Option<usize>, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    let mut saved = None;
    if !raw_mode(true, &mut saved) {
        return choose(title, labels);
    }
    println!("{title} \u{1b}[2m(↑ ↓ to move, Enter to pick)\u{1b}[0m");
    let mut at = 0;
    draw_pick(labels, at, true);
    let mut stdin = std::io::stdin();
    let picked = loop {
        let mut buffer = [0u8; 8];
        let read = stdin.read(&mut buffer);
        let Ok(read) = read else {
            raw_mode(false, &mut saved);
            return Err("cancelled, nothing was saved".into());
        };
        if read == 0 {
            break None;
        }
        match pick_key(&String::from_utf8_lossy(&buffer[..read]), at, labels.len()) {
            Pick::At(moved) => {
                at = moved;
                draw_pick(labels, at, false);
            }
            Pick::Picked(picked) => {
                draw_pick(labels, at, false);
                break Some(picked);
            }
            Pick::Cancel => break None,
        }
    };
    raw_mode(false, &mut saved);
    let _ = std::io::stdout().flush();
    Ok(picked)
}

/// A Provider's name: lower-case letters, digits and dashes, up to 32 (legacy
/// `checkName`).
fn provider_name(name: &str, providers: &[veeloe_runtime_supervisor::providers::Provider]) -> Result<String, String> {
    let allowed = !name.is_empty()
        && name.len() <= 32
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !allowed {
        return Err(format!(
            "a Provider name is lower-case letters, digits and dashes, up to 32, got \"{name}\""
        ));
    }
    if providers.iter().any(|provider| provider.name == name) {
        return Err(format!(
            "a Provider named {name} already exists. Pick another name, or remove it first: veeloe provider remove {name}"
        ));
    }
    Ok(name.to_string())
}

/// A base URL without a trailing slash. Plain http only to this Machine, so a key
/// never crosses a network in clear (legacy `providerUrl`).
fn provider_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| format!("not a URL: {raw}"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(format!(
            "the Provider URL must start with https:// (http:// only for this machine), got {raw}"
        ));
    }
    if url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!("the Provider URL must be just its base, got {raw}"));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// The Provider's key: typed hidden at a terminal, read whole from stdin
/// anywhere else (legacy `readKey`).
fn read_key() -> Result<String, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    if !interactive() {
        let mut key = String::new();
        std::io::stdin().read_to_string(&mut key)?;
        return Ok(key);
    }
    // The tty driver does not echo while this line is typed, so the key never
    // lands on the screen or in a scrollback.
    let quiet = std::process::Command::new("stty")
        .arg("-echo")
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    print!("Provider key: ");
    std::io::stdout().flush()?;
    let mut line = String::new();
    let read = std::io::stdin().read_line(&mut line);
    if quiet {
        let _ = std::process::Command::new("stty").arg("echo").status();
    }
    println!();
    read?;
    Ok(line)
}

async fn pair(home: PathBuf, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let hub = hub_argument(args)
        .or_else(|| load_hub_url(&home))
        .ok_or("no Hub URL: run veeloe pair --hub <url>")?;
    let log: veeloe_runtime_supervisor::pair::PairLog = Arc::new(|line: &str| {
        // The link itself is what a phone scans or a person pastes.
        if line.starts_with("veeloe://") {
            println!("{line}");
        } else {
            println!("{line}");
        }
    });
    let mut options = PairOptions::new(&home, hub);
    options.ttl_seconds = PAIRING_TTL_SECONDS;
    match run_pair(options, log).await? {
        PairResult::Paired => Ok(()),
        PairResult::AlreadyPaired => Ok(()),
        PairResult::Expired => std::process::exit(1),
    }
}

/// What a Provider that would not list its models is told, as the legacy CLI
/// put it (`providers/cli.ts`).
fn provider_problem(problem: &str) -> &'static str {
    match problem {
        "provider.rejected" => {
            "the Provider refused this key. Check the key and run veeloe provider add again"
        }
        "provider.unreachable" => {
            "could not reach the Provider at that URL. Check the URL and your connection, then run veeloe provider add again"
        }
        _ => "the Provider answered with an error. Try again later, or check the URL",
    }
}

/// `provider add|list|remove`: the LLM this Machine talks to. The key is typed
/// hidden or piped in, never an argument (ADR 0042, 0065). At a terminal a
/// missing choice is asked; anywhere else it is named and nothing is asked
/// (legacy `runProviderCommand`).
async fn provider(home: PathBuf, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use veeloe_runtime_supervisor::providers::{save_providers, PRESETS};
    let action = args.first().map(String::as_str).unwrap_or("list");
    let providers = load_providers(&home).unwrap_or_default();
    let flag = |name: &str| -> Option<String> {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };
    match action {
        "list" => {
            if providers.is_empty() {
                println!("no Provider yet. Add one with: veeloe provider add");
            }
            for provider in &providers {
                println!("{}\t{}", provider.name, provider.url);
            }
            Ok(())
        }
        "add" => {
            let mut preset = flag("--preset");
            let mut name = flag("--name");
            let given_url = flag("--url");
            if preset.is_none() && name.is_none() && given_url.is_none() && interactive() {
                let labels: Vec<String> = PRESETS
                    .iter()
                    .map(|(_, label, _, _)| label.to_string())
                    .chain(std::iter::once("Custom (enter a URL)".to_string()))
                    .collect();
                let Some(picked) = pick_with_arrows("Which Provider do you want to add?", &labels)? else {
                    return Err("cancelled, nothing was saved".into());
                };
                preset = PRESETS.get(picked).map(|(id, _, _, _)| id.to_string());
            }
            let (url, fixed_auth, preset) = match preset.as_deref() {
                Some(id) => {
                    let Some((id, _, url, auth)) = PRESETS.iter().find(|(name, ..)| *name == id)
                    else {
                        let ids: Vec<&str> = PRESETS.iter().map(|(id, ..)| *id).collect();
                        return Err(format!(
                            "no built-in Provider {id}. Pick one of: {}",
                            ids.join(", ")
                        )
                        .into());
                    };
                    if given_url.is_some() {
                        return Err(format!(
                            "--preset {id} sets its own URL; drop --url, or leave out --preset for a custom Provider"
                        )
                        .into());
                    }
                    (url.to_string(), Some(*auth), Some(id.to_string()))
                }
                None => {
                    // A custom Provider is named first, then its URL, as the
                    // legacy wizard asked.
                    if name.is_none() {
                        if !interactive() {
                            let ids: Vec<&str> = PRESETS.iter().map(|(id, ..)| *id).collect();
                            return Err(format!(
                                "missing --name: veeloe provider add --name <name> --url <base url> (a name is lower-case letters, digits and dashes, up to 32), or --preset <{}>",
                                ids.join("|")
                            )
                            .into());
                        }
                        name = Some(ask_valid("Name for this Provider: ", |answer| {
                            provider_name(answer, &providers)
                        })?);
                    }
                    let url = match given_url {
                        Some(url) => provider_url(&url)?,
                        None if interactive() => ask_valid(
                            "Base URL (such as https://api.anthropic.com): ",
                            provider_url,
                        )?,
                        None => {
                            return Err(
                                "missing --url: give the Provider's base URL, such as --url https://api.anthropic.com"
                                    .into(),
                            )
                        }
                    };
                    (url, None, None)
                }
            };
            let name = match (name, preset.as_deref()) {
                (Some(name), _) => provider_name(&name, &providers)?,
                (None, Some(id)) => provider_name(id, &providers)?,
                // Unreachable: a custom Provider was named above.
                (None, None) => return Err("missing --name".into()),
            };
            // The key never lands in shell history or `ps`: typed hidden here, or
            // piped in on stdin.
            let key = read_key()?.trim().to_string();
            if key.is_empty() {
                return Err(
                    "no key was given. Type it when asked, or pipe it in: veeloe provider add ... < key-file"
                        .into(),
                );
            }
            let http = ReqwestClient::cli();
            println!("checking {url} ...");
            let auth = match fixed_auth {
                Some(auth) => {
                    match models::list_models(&url, &key, auth, preset.as_deref(), &http).await {
                        Ok(models) => {
                            println!("saved {name} with {} models", models.len());
                            auth
                        }
                        Err(problem) => {
                            println!("not saved: {}", provider_problem(problem));
                            std::process::exit(1);
                        }
                    }
                }
                None => match models::detect_auth(&url, &key, preset.as_deref(), &http).await {
                    Ok((auth, models)) => {
                        println!("saved {name} with {} models", models.len());
                        auth
                    }
                    Err(problem) => {
                        println!("not saved: {}", provider_problem(problem));
                        std::process::exit(1);
                    }
                },
            };
            let mut saved = providers.clone();
            saved.push(veeloe_runtime_supervisor::providers::Provider {
                name: name.clone(),
                url,
                key,
                auth,
                preset,
            });
            save_providers(&home, &saved)?;
            println!("Next: create an Agent with it in the Veeloe app. Start the Runtime with veeloe if it is not running.");
            Ok(())
        }
        "remove" => {
            if providers.is_empty() {
                println!("there is no Provider to remove. Add one with: veeloe provider add");
                std::process::exit(1);
            }
            let mut name = args
                .iter()
                .skip(1)
                .find(|arg| !arg.starts_with("--"))
                .cloned();
            if name.is_none() {
                if !interactive() {
                    return Err(
                        "missing the Provider's name: veeloe provider remove <name> --yes (see them with: veeloe provider list)"
                            .into(),
                    );
                }
                let labels: Vec<String> = providers
                    .iter()
                    .map(|provider| format!("{}  {}", provider.name, provider.url))
                    .collect();
                let Some(picked) = pick_with_arrows("Which Provider do you want to remove?", &labels)? else {
                    return Err("cancelled, nothing was removed".into());
                };
                name = Some(providers[picked].name.clone());
            }
            let name = name.expect("a name");
            if !providers.iter().any(|provider| provider.name == name) {
                println!("no Provider named {name}. See them with: veeloe provider list");
                std::process::exit(1);
            }
            let users: Vec<String> = AgentRegistry::open(&home)
                .map(|registry| registry.all().unwrap_or_default())
                .unwrap_or_default()
                .into_iter()
                .filter(|agent| agent.provider == name)
                .map(|agent| agent.name)
                .collect();
            if users.is_empty() {
                println!("no Agent uses {name}.");
            } else {
                println!(
                    "Agents using {name}: {}. They stop answering until you pick another Provider for them on the Agent's page in the Veeloe app.",
                    users.join(", ")
                );
            }
            if !args.iter().any(|arg| arg == "--yes") {
                if !interactive() {
                    return Err(format!(
                        "not removed: there is no terminal to confirm on. Run it again with --yes: veeloe provider remove {name} --yes"
                    )
                    .into());
                }
                let answer = ask_line(&format!("Remove {name}? [y/N] "))?;
                // A yes only when the answer is y; Enter or anything else keeps it.
                if answer.unwrap_or_default().to_lowercase() != "y" {
                    println!("nothing was removed");
                    std::process::exit(1);
                }
            }
            let saved: Vec<_> = providers
                .into_iter()
                .filter(|provider| provider.name != name)
                .collect();
            save_providers(&home, &saved)?;
            println!("removed {name}. Next: add another with veeloe provider add, or see what is left with veeloe status");
            Ok(())
        }
        other => Err(format!("unknown provider command: {other}").into()),
    }
}

/// The first run, as the legacy CLI did it (legacy `firstRun`): ask for the Hub
/// URL when there is none, pair, then offer a Provider before starting. True when
/// this Machine is paired and the Supervisor may run.
///
/// With no terminal nothing is asked and nothing is written: the three commands
/// that set the Machine up are named instead, and the Supervisor does not start.
async fn first_run(home: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if !load_trust(home).unwrap_or_default().owners.is_empty() {
        return Ok(true);
    }
    if !interactive() {
        // With no Hub URL, that is the first thing to say.
        match load_hub_url(home) {
            None => eprintln!(
                "veeloe: no Hub URL: run veeloe pair --hub <url>, set \"hubUrl\" in {}, or set the VEELOE_HUB_URL environment variable",
                home.join("config.json").display()
            ),
            Some(_) => eprintln!(
                "veeloe: this Machine is not paired yet. From a terminal, run:\n  veeloe pair       pair it with the Veeloe app\n  veeloe provider add\n  veeloe            start the Runtime"
            ),
        }
        return Ok(false);
    }
    let hub = match load_hub_url(home) {
        Some(hub) => normalize_hub_url(&hub).map_err(|error| error.to_string())?,
        None => {
            let Some(answer) = ask_line("Hub URL (wss://... from the Veeloe app): ")? else {
                return Err("no Hub URL was given. Run veeloe again, or veeloe pair --hub <url>".into());
            };
            if answer.is_empty() {
                return Err("no Hub URL was given. Run veeloe again, or veeloe pair --hub <url>".into());
            }
            let hub = normalize_hub_url(&answer).map_err(|error| error.to_string())?;
            veeloe_runtime_supervisor::trust::save_hub_url(home, &hub)?;
            hub
        }
    };
    println!("This Machine is not paired yet. Pair it with the Veeloe app first.\n");
    pair(home.to_path_buf(), std::slice::from_ref(&hub)).await?;
    if load_providers(home).unwrap_or_default().is_empty() {
        println!("\nNext, add a Provider: the LLM your Agents use.\n");
        if let Err(error) = provider(home.to_path_buf(), &["add".to_string()]).await {
            println!("{error}\nYou can add one later with: veeloe provider add");
        }
    }
    println!();
    Ok(true)
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
    let secret_key = load_or_create_machine_key(&home)?;
    let registry = AgentRegistry::open(&home)?;
    let trust = load_trust(&home)?;
    if trust.owners.is_empty() {
        return Err("this Machine is not paired: run veeloe pair".into());
    }
    let _ = logs::record(&home, "info", "runtime.start", json!({}));
    let egress = Arc::new(Egress::open(&home)?);
    // Every command reaches the network only through this proxy, which checks
    // the Egress on each connection; Seatbelt cannot match a domain itself.
    let egress_proxy = veeloe_runtime_supervisor::proxy::start(Arc::clone(&egress)).await?;
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
    let supervisor = Arc::new_cyclic(|me| Supervisor {
        home: home.clone(),
        registry,
        trust: Mutex::new(trust),
        egress,
        secret_key,
        seen: Mutex::new(MemorySeen::default()),
        me: me.clone(),
        budgets: Arc::clone(&budgets),
        routes: Arc::clone(&routes),
        http: Arc::clone(&http),
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
            !allow_budgets
                .exhausted(&agent, veeloe_runtime_supervisor::usage::now_ms())
                .unwrap_or(true)
        })
        .on_usage(move |agent, task, tokens| {
            if let Ok(Some(agent)) = usage_routing.registry.get(agent) {
                let _ = usage_budgets.add(
                    &agent,
                    veeloe_runtime_supervisor::usage::now_ms(),
                    task.unwrap_or(""),
                    tokens,
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
                        },
                    ),
                    None => veeloe_runtime_supervisor::llm::Route::Missing,
                })
            }
        });
    let llm: Arc<dyn SupervisorLlm> = Arc::new(ProxyLlm { proxy });

    let weak = Arc::downgrade(&supervisor);
    // The worker process itself is not wrapped: a Rust binary aborts under
    // `sandbox-exec` on macOS ("failed to allocate a guard page"), so the
    // sandbox is applied to every command the worker runs instead (ADR 0008).
    // The egress it was started with goes with it, for its next connection.
    let egress_proxy_url = egress_proxy.url.clone();
    let wrap: veeloe_runtime_supervisor::workers::Wrap = Arc::new(move |_agent, mut command| {
        command.push("--proxy".to_string());
        command.push(egress_proxy_url.clone());
        command
    });
    let workers = Workers::new(
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
    );
    let _ = supervisor.workers.set(workers);

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
        let answer = request.body(body).send().await.map_err(|error| error.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::{hub_argument, pick_key, Pick};

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn pair_reads_the_hub_url_the_way_the_legacy_cli_did() {
        assert_eq!(
            hub_argument(&args(&["--hub", "ws://127.0.0.1:8080"])),
            Some("ws://127.0.0.1:8080".into())
        );
        assert_eq!(
            hub_argument(&args(&["--hub=wss://hub.example.com"])),
            Some("wss://hub.example.com".into())
        );
        assert_eq!(
            hub_argument(&args(&["ws://127.0.0.1:8080"])),
            Some("ws://127.0.0.1:8080".into())
        );
        assert_eq!(hub_argument(&args(&[])), None);
        assert_eq!(hub_argument(&args(&["--hub"])), None);
    }

    #[test]
    fn an_arrow_pick_moves_wraps_takes_a_number_and_cancels_as_the_legacy_one_did() {
        assert!(matches!(pick_key("\u{1b}[B", 0, 3), Pick::At(1)));
        assert!(matches!(pick_key("j", 2, 3), Pick::At(0)));
        assert!(matches!(pick_key("\u{1b}[A", 0, 3), Pick::At(2)));
        assert!(matches!(pick_key("k", 1, 3), Pick::At(0)));
        assert!(matches!(pick_key("\r", 1, 3), Pick::Picked(1)));
        assert!(matches!(pick_key("3", 0, 3), Pick::Picked(2)));
        // A number outside the list is not a pick.
        assert!(matches!(pick_key("9", 1, 3), Pick::At(1)));
        assert!(matches!(pick_key("\u{1b}", 0, 3), Pick::Cancel));
        assert!(matches!(pick_key("\u{3}", 0, 3), Pick::Cancel));
        assert!(matches!(pick_key("q", 0, 3), Pick::Cancel));
    }
}
