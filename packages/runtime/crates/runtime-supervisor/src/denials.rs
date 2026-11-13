//! What the macOS sandbox refused, made visible at Runtime log level (ADR 0052,
//! 0069; issue #37). Seatbelt does not write a refusal to the process's own
//! stderr: it writes it to the system log, where it looks like
//!
//! ```text
//! kernel: (Sandbox) Sandbox: git(123) deny(1) mach-lookup com.apple.example
//! ```
//!
//! The Runtime reads those lines, keeps the service's name and the process that
//! asked for it, and writes one Runtime log line per refused service. That line
//! is what tells the Owner which name to add to the profile: a service that is
//! missing is added from evidence, one at a time, instead of opening the
//! profile again (ADR 0069).
//!
//! A denial line never carries a file's contents or a path, and a refusal is
//! written once per Agent and service however often a tool retries.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;

/// Which Agent each running worker belongs to, by the worker's process id. A
/// denied process is usually a child of the worker, so the lookup walks the
/// parent chain until it finds one of these.
pub type Running = Arc<dyn Fn() -> HashMap<u32, String> + Send + Sync>;

/// Names a worker or its toolchains run under. A refusal from one of these
/// while a worker is up belongs to that work even when the process has already
/// exited and its parent chain can no longer be read.
const TOOL_NAMES: &[&str] = &[
    "veeloe", "bash", "sh", "git", "bun", "node", "python3", "Python",
];

/// The line a refusal leaves in the system log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Denial {
    /// The program that asked, as the OS named it.
    pub process: String,
    /// Its process id, which is how it is tied back to a worker.
    pub pid: u32,
    /// The service it asked for.
    pub service: String,
}

/// Read one `log stream --style compact` line. `None` for anything that is not
/// a refused mach lookup.
pub fn parse(line: &str) -> Option<Denial> {
    // The system log collapses a repeated denial into one "N duplicate reports"
    // line, which names the service but is not a refusal of its own.
    if line.contains("duplicate reports for Sandbox: ") {
        return None;
    }
    let rest = line.split_once("Sandbox: ")?.1;
    let (process, rest) = rest.split_once('(')?;
    let (pid, rest) = rest.split_once(')')?;
    let pid: u32 = pid.parse().ok()?;
    // `deny(1) mach-lookup com.apple.example`; a duplicate report is not a
    // denial line of its own, and anything else is a file or network refusal.
    let (verdict, rest) = rest.split_once(" mach-lookup ")?;
    if !verdict.trim().starts_with("deny(") {
        return None;
    }
    let service = rest.split_whitespace().next()?;
    if process.is_empty() || service.is_empty() {
        return None;
    }
    Some(Denial {
        process: process.to_string(),
        pid,
        service: service.to_string(),
    })
}

/// The parent of `pid`, or `None` when it cannot be read: the process is gone,
/// or it is the first one.
#[cfg(target_os = "macos")]
fn parent_of(pid: u32) -> Option<u32> {
    use std::mem;
    let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
    let size = mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if read != size || info.pbi_ppid == 0 || info.pbi_ppid == pid {
        return None;
    }
    Some(info.pbi_ppid)
}

#[cfg(not(target_os = "macos"))]
fn parent_of(_pid: u32) -> Option<u32> {
    None
}

/// The Agent whose worker is `pid` or one of its ancestors.
fn owner_of(pid: u32, running: &HashMap<u32, String>) -> Option<String> {
    let mut current = pid;
    // A short chain: worker, command shell, the tool. A longer one is another
    // program on the Machine, not this work.
    for _ in 0..8 {
        if let Some(agent) = running.get(&current) {
            return Some(agent.clone());
        }
        current = parent_of(current)?;
    }
    None
}

/// One line the Runtime log takes for a refusal, and what makes two refusals
/// the same line.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// The Agent whose work asked, when the process chain still names one.
    pub agent: Option<String>,
    /// The service that was refused: the only thing the Owner acts on.
    pub service: String,
    pub level: &'static str,
    /// What the log holds: the service and the process, never a path.
    pub fields: serde_json::Value,
}

impl Line {
    /// The dedupe key: one line per Agent and service. The Owner's own
    /// refusals (no Agent) are keyed apart from any Agent's, so a service Agent
    /// A already needed is still named when Agent B needs it.
    pub fn key(&self) -> (Option<String>, String) {
        (self.agent.clone(), self.service.clone())
    }
}

/// What to write for one refusal, if anything. `None` when the refusal is
/// someone else's: another app on the Machine has its own sandbox and its own
/// denials, and they do not belong in this Runtime's log.
pub fn line_for(denial: &Denial, running: &HashMap<u32, String>) -> Option<Line> {
    let agent = owner_of(denial.pid, running);
    if agent.is_none() {
        // The pid chain is gone (the tool already exited) or was never a
        // worker's. A name alone can only stand for this work while exactly one
        // worker runs: with two, the Owner's own `git` would be counted as one
        // of theirs.
        if running.len() != 1 || !TOOL_NAMES.contains(&denial.process.as_str()) {
            return None;
        }
    }
    let mut fields = json!({ "service": denial.service, "process": denial.process });
    if let Some(agent) = &agent {
        fields["agent"] = json!(agent);
    }
    Some(Line {
        agent,
        service: denial.service.clone(),
        level: "warn",
        fields,
    })
}

/// The system log reader, alive while the Runtime is. Dropping it stops the
/// `log stream` it started.
pub struct Denials {
    child: Child,
    stopping: Arc<AtomicBool>,
}

impl Denials {
    /// Follow the system log for sandbox refusals. `None` when this system has
    /// no such log (everything but macOS); a Runtime without it still runs,
    /// it just cannot show a refusal (ADR 0069).
    #[cfg(target_os = "macos")]
    pub fn start(home: PathBuf, running: Running) -> Option<Self> {
        let mut child = Command::new("/usr/bin/log")
            .args([
                "stream",
                "--style",
                "compact",
                "--predicate",
                // A denial is the kernel's, and its message starts this way.
                // Duplicate reports are a separate message and are skipped.
                "eventMessage BEGINSWITH \"Sandbox: \"",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdout = child.stdout.take()?;
        let stopping = Arc::new(AtomicBool::new(false));
        let seen = Arc::new(Mutex::new(HashSet::new()));
        let stop = Arc::clone(&stopping);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                let Some(denial) = parse(&line) else {
                    continue;
                };
                let Some(line) = line_for(&denial, &running()) else {
                    continue;
                };
                // The same service is worth naming once per Agent: a tool that
                // retries must not turn one missing name into a wall of lines,
                // and Agent B's need is not Agent A's. Another app's refusal is
                // not counted, so our own later one still is.
                if !seen.lock().expect("seen").insert(line.key()) {
                    continue;
                }
                let _ = crate::logs::record(&home, line.level, "sandbox.denied", line.fields);
            }
        });
        Some(Self { child, stopping })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn start(_home: PathBuf, _running: Running) -> Option<Self> {
        None
    }
}

impl Drop for Denials {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refused_mach_lookup_is_read_out_of_the_system_log() {
        let line = "2026-11-13 10:25:28.434071+0700 0x314199   Error       0x0   0 kernel: (Sandbox) Sandbox: git(31551) deny(1) mach-lookup com.apple.system.notification_center";
        assert_eq!(
            parse(line),
            Some(Denial {
                process: "git".into(),
                pid: 31551,
                service: "com.apple.system.notification_center".into(),
            })
        );
    }

    #[test]
    fn a_refusal_that_is_not_a_mach_lookup_is_ignored() {
        // A file refusal has a path, which must never reach the Runtime log.
        let file = "kernel: (Sandbox) Sandbox: git(1) deny(1) file-read-data /Users/someone/.ssh/id_ed25519";
        assert_eq!(parse(file), None);
        // A duplicate report is not a denial of its own.
        let duplicate = "kernel: (Sandbox) 10 duplicate reports for Sandbox: node(2) deny(1) mach-lookup com.apple.FSEvents";
        assert_eq!(parse(duplicate).map(|denial| denial.service), None);
        assert_eq!(parse("something else entirely"), None);
    }

    #[test]
    fn another_apps_refusal_stays_out_of_the_runtimes_log() {
        let denial = Denial {
            process: "com.apple.WebKit.Networking".into(),
            pid: 42,
            service: "com.apple.diagnosticd".into(),
        };
        let running = HashMap::from([(7u32, "a1".to_string())]);
        assert_eq!(line_for(&denial, &running), None);
        // With no worker running there is no work to attribute a refusal to.
        assert_eq!(line_for(&denial, &HashMap::new()), None);
    }

    #[test]
    fn a_tool_that_already_exited_is_still_worth_a_line() {
        let denial = Denial {
            process: "git".into(),
            pid: 42,
            service: "com.apple.SecurityServer".into(),
        };
        let running = HashMap::from([(7u32, "a1".to_string())]);
        let line = line_for(&denial, &running).expect("a line");
        assert_eq!(line.level, "warn");
        assert_eq!(line.fields["service"], "com.apple.SecurityServer");
        assert_eq!(line.fields["process"], "git");
        // The pid is not written: it says nothing after the process is gone.
        assert!(line.fields.get("agent").is_none());
    }

    #[test]
    fn a_name_alone_means_this_work_only_while_one_worker_runs() {
        let denial = Denial {
            process: "git".into(),
            pid: 42,
            service: "com.apple.SecurityServer".into(),
        };
        // Two workers: the name could be either one's command, or the Owner's
        // own `git`, so the refusal is not attributed to an Agent.
        let two = HashMap::from([(7u32, "a1".to_string()), (8u32, "a2".to_string())]);
        assert!(line_for(&denial, &two).is_none());
    }

    #[test]
    fn the_same_service_is_a_separate_line_for_each_agent() {
        let denial = Denial {
            process: "git".into(),
            pid: 42,
            service: "com.apple.SecurityServer".into(),
        };
        let first =
            line_for(&denial, &HashMap::from([(42u32, "a1".to_string())])).expect("a line for a1");
        let other = Denial {
            pid: 43,
            ..denial.clone()
        };
        let second =
            line_for(&other, &HashMap::from([(43u32, "a2".to_string())])).expect("a line for a2");
        assert_eq!(first.agent.as_deref(), Some("a1"));
        assert_eq!(second.agent.as_deref(), Some("a2"));
        // The reader dedupes on this key, so a1's line cannot swallow a2's.
        assert_ne!(first.key(), second.key());
        // The same Agent asking again for the same service is one line.
        let again = Denial {
            pid: 44,
            ..denial.clone()
        };
        let repeat = line_for(&again, &HashMap::from([(44u32, "a1".to_string())]))
            .expect("a second line for a1");
        assert_eq!(first.key(), repeat.key());
    }
}
