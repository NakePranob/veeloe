//! The toolchains a worker is expected to run, checked when its worker opens
//! (ADR 0008, 0069; issue #35). Each tool runs inside the same rules the worker
//! gets, so a name that comes back `ok` is a name the worker can run too, and
//! the log holds names and results only: a path or a file's contents never
//! belong in it (ADR 0052).
//!
//! A tool that cannot run is information for the Owner, not a gate: the worker
//! starts and a Turn ends whether the check finds all four or none.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;
use veeloe_runtime_core::sandbox::{Policy, Sandbox};

/// What work on this Machine cannot be done without: the command line, the
/// Python its tools come with, the Node its projects use, and bun.
pub const TOOLS: &[&str] = &["git", "python3", "node", "bun"];

/// Long enough for a cold start on a busy Machine, short enough that a stuck
/// tool cannot hold the check. It runs beside the worker, never before it.
const TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(20);

/// How one tool answered. A result, not an exit code: the profile's own words
/// and the tool's output stay out of the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The tool ran and said its version.
    Ok,
    /// The rules would not let it run, or it is not there at all.
    Missing,
    /// It ran and failed, which is what a toolchain with a missing library does.
    Refused,
    /// It did not answer in time.
    Timeout,
}

impl Outcome {
    /// The word the Runtime log holds.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Missing => "missing",
            Self::Refused => "refused",
            Self::Timeout => "timeout",
        }
    }
}

/// One tool and how it answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub tool: String,
    pub outcome: Outcome,
}

/// Ask each tool for its version, under `policy`, the way the worker's `PATH`
/// resolves it. Never fails: an absent tool is a `Report` too.
pub fn check(policy: &Policy, path: &str) -> Vec<Report> {
    TOOLS
        .iter()
        .map(|tool| Report {
            tool: (*tool).to_string(),
            outcome: run(policy, path, tool),
        })
        .collect()
}

fn run(policy: &Policy, path: &str, tool: &str) -> Outcome {
    // A tool that is not on the worker's `PATH` is missing whatever the rules
    // say; only a tool that is there can be refused by them.
    if !on_path(path, tool) {
        return Outcome::Missing;
    }
    // `$HOME` is `.home` inside the Agent's folder, not the folder itself: a
    // tool that writes `~/.gitconfig` writes where the worker's would, and the
    // folder's Workdir and TMPDIR are not mistaken for a home.
    let home = Path::new(&policy.folder).join(".home");
    let argv = Sandbox::new(policy.clone()).wrap(&[tool.to_string(), "--version".to_string()]);
    let Some((program, rest)) = argv.split_first() else {
        return Outcome::Missing;
    };
    // The wrapper is not run with the worker's `PATH`: on Linux it is a bare
    // `bwrap`, and the check gives the command the worker's `PATH`, which need
    // not carry it. Find it the way the supervisor itself was started.
    let Some(program) = absolute(program) else {
        return Outcome::Missing;
    };
    let mut command = Command::new(program);
    command
        .args(rest)
        // What the worker itself gets: the same `PATH`, its own home, cache,
        // git config and TMPDIR (ADR 0069). The supervisor makes `.home`
        // before it starts the worker and before it runs this check, so the
        // paths exist here. Nothing else is inherited, and no output is read.
        .env_clear()
        .env("PATH", path)
        .env("HOME", &home)
        .env("XDG_CACHE_HOME", home.join(".cache"))
        .env("GIT_CONFIG_GLOBAL", home.join(".gitconfig"))
        .env("TMPDIR", &policy.tmp)
        .current_dir(&policy.workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else {
        return Outcome::Missing;
    };
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Outcome::Ok
                } else {
                    Outcome::Refused
                }
            }
            Ok(None) => {}
            Err(_) => return Outcome::Missing,
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Outcome::Timeout;
        }
        std::thread::sleep(POLL);
    }
}

/// `program` as an absolute path: itself when it already is one, otherwise the
/// first executable of that name on the supervisor's own `PATH`.
fn absolute(program: &str) -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let path = Path::new(program);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    std::env::var("PATH").ok()?.split(':').find_map(|dir| {
        if dir.is_empty() {
            return None;
        }
        let candidate = Path::new(dir).join(program);
        let executable = std::fs::metadata(&candidate)
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
        executable.then_some(candidate)
    })
}

/// Whether `tool` is an executable file in one of `path`'s folders. The
/// supervisor looks; the sandbox still decides whether the worker may run it.
fn on_path(path: &str, tool: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(tool))
        .any(|candidate| {
            std::fs::metadata(&candidate)
                .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        })
}

/// The report each Agent's worker last wrote, so a worker that keeps ending
/// does not fill the log with the same four names. Keyed by Agent: two Agents
/// compared with each other's report would suppress a real change.
#[derive(Default)]
pub struct Reported {
    last: Mutex<HashMap<String, Vec<Report>>>,
}

impl Reported {
    /// Write the report at Runtime log level: the Agent, each tool's name and
    /// its result, and nothing else. The same report twice in a row for the
    /// same Agent is written once.
    pub fn record(&self, home: &Path, agent: &str, reports: &[Report]) {
        let mut last = self.last.lock().expect("reported");
        if last.get(agent).map(Vec::as_slice) == Some(reports) {
            return;
        }
        last.insert(agent.to_string(), reports.to_vec());
        let tools: BTreeMap<&str, &str> = reports
            .iter()
            .map(|report| (report.tool.as_str(), report.outcome.as_str()))
            .collect();
        // Anything the rules refuse is worth the Owner's eye, an all-ok line is not.
        let level = if reports.iter().all(|report| report.outcome == Outcome::Ok) {
            "info"
        } else {
            "warn"
        };
        let _ = crate::logs::record(
            home,
            level,
            "toolchain.check",
            json!({ "agent": agent, "tools": tools }),
        );
    }
}
