//! Where a Linux worker runs: inside a cgroup v2 scope of the owner's own user
//! manager, with `MemoryMax`, `CPUQuota` and `TasksMax` from `limits`, so one
//! Agent cannot stop the machine (issue #48, ADR 0069).
//!
//! A scope, not a service: `systemd-run --scope` runs the command directly, so
//! the worker keeps the pipes its supervisor gave it, and the user manager has
//! nothing to do with its stdio. The command still has to be found and started
//! on this Machine, which is all `systemd-run` becomes here.
//!
//! A Machine without a user systemd session — most containers, and every Mac —
//! keeps what #47 put in place: `RLIMIT_CPU` and the resident-memory watch.
//!
//! Two things the wrapper changes about what the supervisor can tell. The
//! process it holds is `systemd-run`, so CPU and memory are summed over that
//! process and everything below it; the worker is below it. And `systemd-run`
//! may report a scope that failed — and a kill from the cgroup's own OOM — as
//! an exit code instead of a signal, so an exit code names no limit here and
//! such a kill can only be reported as a plain end (see `limits::breach`).

#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};

use crate::limits::Limits;

/// How long the user manager may take to answer before it counts as missing.
/// Detection runs on the first worker's session path (issue #48), once, and is
/// cached; this timeout bounds that one check, so a Machine whose systemd is
/// wedged costs its first worker up to two seconds, and no later one anything.
#[cfg(target_os = "linux")]
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The three cgroup v2 settings one worker's scope carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scope {
    pub memory_mb: u64,
    pub cpu_percent: u64,
    pub tasks: u64,
}

impl Scope {
    pub fn of(limits: &Limits) -> Self {
        Self {
            memory_mb: limits.memory_mb,
            cpu_percent: limits.cpu_percent,
            tasks: limits.tasks,
        }
    }
}

/// The argv that runs `worker` inside its own scope. The worker's own argv is
/// untouched after `--`, including the `--` its sandbox may have of its own.
pub fn argv(scope: Scope, worker: &[String]) -> Vec<String> {
    let mut argv = vec![
        "systemd-run".to_string(),
        "--user".to_string(),
        "--scope".to_string(),
        "--quiet".to_string(),
        "--collect".to_string(),
        "-p".to_string(),
        format!("MemoryMax={}M", scope.memory_mb),
        "-p".to_string(),
        format!("CPUQuota={}%", scope.cpu_percent),
        "-p".to_string(),
        format!("TasksMax={}", scope.tasks),
        "--".to_string(),
    ];
    argv.extend(worker.iter().cloned());
    argv
}

/// Whether this Machine can put a worker in a scope. Asked once per supervisor,
/// on the first worker's session path, and cached there (issue #48).
#[cfg(target_os = "linux")]
pub fn detect() -> bool {
    // Both halves matter: `systemd-run` may be installed while the owner has no
    // user manager to connect to, which is what a container usually looks like.
    on_path("systemd-run") && quiet_success("systemctl", &["--user", "show-environment"])
}

/// macOS has no cgroups (ADR 0069), so nothing is ever scoped there.
#[cfg(not(target_os = "linux"))]
pub fn detect() -> bool {
    false
}

/// Whether `program` is an executable on `PATH`, which is how the Runtime would
/// find it when it starts a worker.
#[cfg(target_os = "linux")]
fn on_path(program: &str) -> bool {
    path_has(&std::env::var_os("PATH").unwrap_or_default(), program)
}

/// The same question asked of a given `PATH`, so a test can build one.
#[cfg(target_os = "linux")]
fn path_has(path: &std::ffi::OsStr, program: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;

    std::env::split_paths(path).any(|dir| {
        let candidate = dir.join(program);
        std::fs::metadata(candidate)
            .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    })
}

/// Runs a command that is expected to answer at once, and reads it as yes only
/// when it exits cleanly in time. A machine whose systemd never answers costs
/// one timeout, once.
#[cfg(target_os = "linux")]
fn quiet_success(program: &str, args: &[&str]) -> bool {
    let Ok(mut child) = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The name of the Runtime log event that says the scope could not be used, so
/// the older caps are all there is (issue #48).
pub const UNAVAILABLE: &str = "worker.cgroup_unavailable";

/// Why the scope is not in use: this Machine has no user systemd to make one
/// with.
pub const NO_SYSTEMD: &str = "no_systemd";

/// Why the scope is not in use: the scope `systemd-run` opened failed before
/// the worker said Ready. The event carries exactly one reason, so the Owner
/// can tell a Machine without cgroups from one whose cgroups refused the worker.
pub const SCOPE_FAILED: &str = "scope_failed";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scope_names_every_limit_from_the_config() {
        let limits = Limits {
            memory_mb: 512,
            cpu_percent: 150,
            tasks: 64,
            ..Limits::default()
        };
        let worker = vec![
            "bwrap".to_string(),
            "--".to_string(),
            "veeloe-worker".to_string(),
        ];
        assert_eq!(
            argv(Scope::of(&limits), &worker),
            vec![
                "systemd-run",
                "--user",
                "--scope",
                "--quiet",
                "--collect",
                "-p",
                "MemoryMax=512M",
                "-p",
                "CPUQuota=150%",
                "-p",
                "TasksMax=64",
                "--",
                "bwrap",
                "--",
                "veeloe-worker",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
    }

    /// The real wrapper on a Machine that has one: a scope with these settings
    /// starts `true` and exits cleanly. Skipped where there is no user systemd
    /// (a container, a Mac), which is the Machine the fallback covers.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_real_scope_starts_a_command_when_the_machine_has_one() {
        if !detect() {
            return;
        }
        let argv = argv(Scope::of(&Limits::default()), &["true".to_string()]);
        let status = Command::new(&argv[0])
            .args(&argv[1..])
            .stdin(Stdio::null())
            .status()
            .expect("systemd-run starts");
        assert!(status.success(), "the scope exited with {status}");
    }

    #[test]
    fn a_worker_argv_is_never_reordered() {
        let worker: Vec<String> = ["a", "b", "--", "c"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let argv = argv(Scope::of(&Limits::default()), &worker);
        assert_eq!(&argv[argv.len() - worker.len()..], worker.as_slice());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn path_lookup_finds_only_executables() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("dir");
        let plain = dir.path().join("not-a-program");
        std::fs::write(&plain, b"x").expect("write");
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).expect("mode");
        let program = dir.path().join("a-program");
        std::fs::write(&program, b"#!/bin/sh\n").expect("write");
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).expect("mode");

        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut entries = vec![dir.path().to_path_buf()];
        entries.extend(std::env::split_paths(&path));
        let joined = std::env::join_paths(entries).expect("a path");
        assert!(path_has(&joined, "a-program"));
        assert!(!path_has(&joined, "not-a-program"));
        assert!(!path_has(&joined, "nothing-here"));
    }

    /// A Mac, and every container, has no user systemd: nothing is scoped and
    /// nothing is asked at startup.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn a_machine_without_systemd_scopes_nothing() {
        assert!(!detect());
    }

    #[test]
    fn the_unavailable_event_keeps_its_name() {
        assert_eq!(UNAVAILABLE, "worker.cgroup_unavailable");
    }

    #[test]
    fn the_unavailable_reasons_keep_their_names() {
        assert_eq!(NO_SYSTEMD, "no_systemd");
        assert_eq!(SCOPE_FAILED, "scope_failed");
    }
}
