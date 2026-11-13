//! What one worker may use (issue #47). macOS has no cgroups, so the OS caps
//! the worker's CPU time with `RLIMIT_CPU` (ADR 0069) and the supervisor ends
//! it when its resident memory passes the limit. Linux is unchanged: its cgroup
//! scope is a later ticket.
//!
//! `RLIMIT_CPU` counts CPU seconds, not elapsed time: a worker that waits on
//! the network all day never reaches it, which is intended.

use std::path::Path;
use std::process::ExitStatus;
use std::sync::Arc;

use serde_json::Value;

/// How long one worker may burn CPU, and how much resident memory it and the
/// commands under it may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub cpu_seconds: u64,
    pub memory_mb: u64,
}

pub const DEFAULT_CPU_SECONDS: u64 = 1_800;
pub const DEFAULT_MEMORY_MB: u64 = 4_096;

impl Default for Limits {
    fn default() -> Self {
        Self {
            cpu_seconds: DEFAULT_CPU_SECONDS,
            memory_mb: DEFAULT_MEMORY_MB,
        }
    }
}

/// The names the Runtime log uses for each limit.
pub const CPU: &str = "cpu";
pub const MEMORY: &str = "memory";

/// Reads one process's resident memory in bytes, or `None` when this system
/// cannot say. Injected by a test so a limit can be crossed without a process
/// that really eats memory (ADR 0022).
pub type ResidentMemory = Arc<dyn Fn(u32) -> Option<u64> + Send + Sync>;

/// The limits this Machine runs under: `limits` in `config.json`, with a
/// warning for every value that cannot be read. A bad value falls back to its
/// default and never keeps the Runtime from starting.
pub fn load(home: &Path) -> Limits {
    let config = crate::json_file::read_json_file(&home.join("config.json"))
        .ok()
        .flatten();
    let (limits, invalid) = read(config.as_ref());
    for field in invalid {
        let _ = crate::logs::record(
            home,
            "warn",
            "limits.invalid",
            serde_json::json!({ "field": field }),
        );
    }
    limits
}

/// The limits a config value names, and the fields it could not read. Kept
/// apart from `load` so the rule is checked without a file on disk.
pub fn read(config: Option<&Value>) -> (Limits, Vec<&'static str>) {
    let mut limits = Limits::default();
    let mut invalid = Vec::new();
    let Some(value) = config.and_then(|config| config.get("limits")) else {
        return (limits, invalid);
    };
    let Some(named) = value.as_object() else {
        invalid.push("limits");
        return (limits, invalid);
    };
    match named.get("cpuSeconds") {
        None => {}
        Some(value) => match value.as_u64() {
            Some(seconds) if seconds > 0 => limits.cpu_seconds = seconds,
            _ => invalid.push("cpuSeconds"),
        },
    }
    match named.get("memoryMb") {
        None => {}
        Some(value) => match value.as_u64() {
            Some(mb) if mb > 0 => limits.memory_mb = mb,
            _ => invalid.push("memoryMb"),
        },
    }
    (limits, invalid)
}

/// The limit and the signal that ended a worker, when the OS cut it. The soft
/// `RLIMIT_CPU` arrives as `SIGXCPU`, and the hard one as `SIGKILL`. A kill
/// this Runtime made for memory is not the CPU's, so it answers nothing.
pub fn breach(
    status: &ExitStatus,
    killed_for_memory: bool,
) -> Option<(&'static str, &'static str)> {
    if killed_for_memory {
        return None;
    }
    match signal_of(status)? {
        libc::SIGXCPU => Some((CPU, "SIGXCPU")),
        libc::SIGKILL => Some((CPU, "SIGKILL")),
        _ => None,
    }
}

#[cfg(unix)]
fn signal_of(status: &ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn signal_of(_status: &ExitStatus) -> Option<i32> {
    None
}

/// The Worker counts this limit as CPU seconds: soft is what the config says,
/// hard is a minute more, so the worker sees `SIGXCPU` and has a chance to end
/// before the OS kills it outright.
#[cfg(target_os = "macos")]
pub fn capping_cpu_time(command: &mut tokio::process::Command, cpu_seconds: u64) {
    let soft = cpu_seconds as libc::rlim_t;
    let hard = cpu_seconds.saturating_add(60) as libc::rlim_t;
    // `setrlimit` is async-signal-safe, which is all a `pre_exec` may call.
    unsafe {
        command.pre_exec(move || {
            let limit = libc::rlimit {
                rlim_cur: soft,
                rlim_max: hard,
            };
            if libc::setrlimit(libc::RLIMIT_CPU, &limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// One worker's resident memory, as the OS reports it (`proc_pidinfo`).
#[cfg(target_os = "macos")]
pub fn resident_bytes(pid: u32) -> Option<u64> {
    let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTASKINFO,
            0,
            &mut info as *mut libc::proc_taskinfo as *mut libc::c_void,
            size,
        )
    };
    (read == size).then_some(info.pti_resident_size)
}

/// Ends a worker and every process below it. A worker's commands are its
/// children and outlive it on macOS, so killing only the worker would leave the
/// runaway command behind.
#[cfg(target_os = "macos")]
pub fn kill_tree(pid: u32) {
    let children = descendants(pid);
    kill(pid);
    for child in children {
        kill(child);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn kill_tree(pid: u32) {
    kill(pid);
}

fn kill(pid: u32) {
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}

/// Every process below `pid`, found through the OS rather than guessed from a
/// process group a command could leave.
#[cfg(target_os = "macos")]
pub(crate) fn descendants(pid: u32) -> Vec<u32> {
    let mut all = Vec::new();
    let mut frontier = vec![pid];
    while let Some(parent) = frontier.pop() {
        for child in children_of(parent) {
            if child != pid && !all.contains(&child) {
                all.push(child);
                frontier.push(child);
            }
        }
    }
    all
}

#[cfg(target_os = "macos")]
fn children_of(pid: u32) -> Vec<u32> {
    let mut capacity = 64usize;
    loop {
        let mut buffer = vec![0 as libc::pid_t; capacity];
        let size = (capacity * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
        let found = unsafe {
            libc::proc_listchildpids(
                pid as libc::pid_t,
                buffer.as_mut_ptr() as *mut libc::c_void,
                size,
            )
        };
        if found <= 0 {
            return Vec::new();
        }
        let found = found as usize;
        // A full buffer may be a list cut short, so ask again with room.
        if found < capacity || capacity >= 65_536 {
            return buffer[..found.min(capacity)]
                .iter()
                .filter(|child| **child > 0)
                .map(|child| *child as u32)
                .collect();
        }
        capacity *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::process::ExitStatusExt;
    use tempfile::tempdir;

    #[test]
    fn limits_are_read_from_the_config_with_sensible_defaults() {
        let home = tempdir().expect("home");
        assert_eq!(
            load(home.path()),
            Limits::default(),
            "a Machine without a config gets the defaults"
        );
        std::fs::write(
            home.path().join("config.json"),
            json!({
                "hubUrl": "wss://hub.test",
                "limits": { "cpuSeconds": 120, "memoryMb": 512 },
            })
            .to_string(),
        )
        .expect("config");
        assert_eq!(
            load(home.path()),
            Limits {
                cpu_seconds: 120,
                memory_mb: 512
            }
        );
    }

    #[test]
    fn limits_that_make_no_sense_fall_back_and_are_warned_about() {
        for (limits, fields) in [
            (
                json!({ "cpuSeconds": 0, "memoryMb": -4 }),
                vec!["cpuSeconds", "memoryMb"],
            ),
            (
                json!({ "cpuSeconds": "soon", "memoryMb": true }),
                vec!["cpuSeconds", "memoryMb"],
            ),
            (json!("lots"), vec!["limits"]),
        ] {
            let home = tempdir().expect("home");
            std::fs::write(
                home.path().join("config.json"),
                json!({ "limits": limits }).to_string(),
            )
            .expect("config");
            assert_eq!(load(home.path()), Limits::default());
            let warnings: Vec<Value> = crate::logs::recent(home.path())
                .expect("logs")
                .iter()
                .map(|line| serde_json::from_str(line).expect("json"))
                .filter(|value: &Value| value["event"] == "limits.invalid")
                .collect();
            assert_eq!(warnings.len(), fields.len(), "{warnings:?}");
            for (warning, field) in warnings.iter().zip(fields) {
                assert_eq!(warning["level"], "warn");
                assert_eq!(warning["fields"]["field"], field);
            }
        }
    }

    #[test]
    fn a_broken_config_file_still_starts_with_the_defaults() {
        let home = tempdir().expect("home");
        std::fs::write(home.path().join("config.json"), "{ not json").expect("config");
        assert_eq!(load(home.path()), Limits::default());
    }

    #[test]
    fn the_os_cut_is_named_only_when_it_is_the_cpus() {
        let status = |signal: i32| ExitStatus::from_raw(signal);
        assert_eq!(
            breach(&status(libc::SIGXCPU), false),
            Some((CPU, "SIGXCPU"))
        );
        assert_eq!(
            breach(&status(libc::SIGKILL), false),
            Some((CPU, "SIGKILL")),
            "the hard RLIMIT_CPU is a SIGKILL"
        );
        assert_eq!(breach(&status(libc::SIGKILL), true), None);
        assert_eq!(breach(&status(libc::SIGTERM), false), None);
        assert_eq!(breach(&status(0), false), None);
    }

    /// The real thing: a busy child with `RLIMIT_CPU` is stopped by the OS.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn a_busy_child_is_stopped_by_its_cpu_limit() {
        use std::process::Stdio;
        use std::time::Duration;

        let mut command = tokio::process::Command::new("/bin/sh");
        command
            .args(["-c", "while :; do :; done"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        capping_cpu_time(&mut command, 1);
        let mut child = command.spawn().expect("a busy child");
        let status = tokio::time::timeout(Duration::from_secs(15), child.wait())
            .await
            .expect("the CPU limit never arrived")
            .expect("wait");
        let signal = status.signal().expect("a signal, not a clean exit");
        assert!(
            signal == libc::SIGXCPU || signal == libc::SIGKILL,
            "it ended with {signal}, not its CPU limit"
        );
    }

    /// A command a worker starts is the worker's child, and on macOS it would
    /// outlive the worker if only the worker were killed.
    #[cfg(target_os = "macos")]
    #[test]
    fn killing_a_workers_tree_takes_its_commands_with_it() {
        use std::time::{Duration, Instant};

        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 30 & sleep 30"])
            .spawn()
            .expect("a worker with commands");
        let end = Instant::now() + Duration::from_secs(5);
        let mut children = Vec::new();
        while Instant::now() < end {
            children = descendants(child.id());
            if !children.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!children.is_empty(), "the commands were not found");
        kill_tree(child.id());
        let _ = child.wait().expect("the worker ends");
        for pid in children {
            let end = Instant::now() + Duration::from_secs(5);
            while Instant::now() < end && unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 {
                std::thread::sleep(Duration::from_millis(20));
            }
            assert!(
                unsafe { libc::kill(pid as libc::pid_t, 0) } != 0,
                "command {pid} survived its worker"
            );
        }
    }
}
