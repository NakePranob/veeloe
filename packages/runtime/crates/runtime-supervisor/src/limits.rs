//! What one worker may use (issues #47, #48). Every system caps the worker's CPU
//! time with `RLIMIT_CPU` (ADR 0069) and the supervisor ends it when its
//! resident memory passes the limit. On Linux with a user systemd session the
//! kernel does the capping instead, through a cgroup scope (`crate::cgroup`);
//! both stay in place there, the scope as the real ceiling and these as the
//! backstop for a Machine without one.
//!
//! The keys of `limits` in `config.json`, all optional:
//!
//! | key | default | what it caps |
//! |---|---|---|
//! | `cpuSeconds` | 1800 | CPU time, through `RLIMIT_CPU` |
//! | `memoryMb` | 4096 | resident memory: `MemoryMax` in the cgroup, the watch otherwise |
//! | `cpuPercent` | 200 | `CPUQuota` in the cgroup (a rate: 200 = two cores) |
//! | `tasks` | 512 | `TasksMax` in the cgroup: the worker and its processes |
//!
//! A value that cannot be read, or is outside what the OS takes, falls back to
//! its default with one `limits.invalid` warning and never keeps the Runtime
//! from starting.
//!
//! `RLIMIT_CPU` counts CPU seconds, not elapsed time: a worker that waits on
//! the network all day never reaches it, which is intended.

use std::path::Path;
use std::process::ExitStatus;
use std::sync::Arc;

use serde_json::Value;

/// How long one worker may burn CPU, how much resident memory it and the
/// commands under it may hold, how much CPU it may use at once, and how many
/// processes it may have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub cpu_seconds: u64,
    pub memory_mb: u64,
    /// The `CPUQuota` a Linux cgroup scope is given: a rate in percent of one
    /// core, so 200 is two cores (`RLIMIT_CPU` has no such shape).
    pub cpu_percent: u64,
    /// The `TasksMax` a Linux cgroup scope is given: the worker and every
    /// process it starts.
    pub tasks: u64,
}

pub const DEFAULT_CPU_SECONDS: u64 = 1_800;
pub const DEFAULT_MEMORY_MB: u64 = 4_096;
pub const DEFAULT_CPU_PERCENT: u64 = 200;
pub const DEFAULT_TASKS: u64 = 512;
/// The most CPU time one worker may be given. A week is far more than any Turn
/// needs, and far below `RLIM_INFINITY`, so `setrlimit` is never handed a value
/// the OS would refuse; anything above it falls back to the default.
pub const MAX_CPU_SECONDS: u64 = 7 * 24 * 60 * 60;
/// The most CPU a scope may be given, in percent of one core: 64 cores' worth.
/// Anything above it falls back to the default rather than failing the scope.
pub const MAX_CPU_PERCENT: u64 = 6_400;
/// The most processes a scope may be given. Far above any Turn's needs and far
/// below the kernel's own `pids.max` ceiling.
pub const MAX_TASKS: u64 = 65_536;

impl Default for Limits {
    fn default() -> Self {
        Self {
            cpu_seconds: DEFAULT_CPU_SECONDS,
            memory_mb: DEFAULT_MEMORY_MB,
            cpu_percent: DEFAULT_CPU_PERCENT,
            tasks: DEFAULT_TASKS,
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
            Some(seconds) if seconds > 0 && seconds <= MAX_CPU_SECONDS => {
                limits.cpu_seconds = seconds;
            }
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
    match named.get("cpuPercent") {
        None => {}
        Some(value) => match value.as_u64() {
            Some(percent) if percent > 0 && percent <= MAX_CPU_PERCENT => {
                limits.cpu_percent = percent;
            }
            _ => invalid.push("cpuPercent"),
        },
    }
    match named.get("tasks") {
        None => {}
        Some(value) => match value.as_u64() {
            Some(tasks) if tasks > 0 && tasks <= MAX_TASKS => limits.tasks = tasks,
            _ => invalid.push("tasks"),
        },
    }
    (limits, invalid)
}

/// What ended a worker, as far as this Runtime can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cut {
    /// The OS cut it at one of the limits this Runtime set.
    Limit {
        limit: &'static str,
        signal: &'static str,
    },
    /// A signal ended it while it was under every limit, so nothing of ours
    /// did: a `kill -9` from the Owner, or Jetsam.
    Signal { signal: &'static str },
}

/// The limit and signal that ended a worker, when the OS cut it. The soft
/// `RLIMIT_CPU` arrives as `SIGXCPU`, and the hard one as `SIGKILL` — but any
/// `kill -9` or Jetsam is a `SIGKILL` too, so that one only names the CPU when
/// the worker had already burned the CPU time its soft limit allows
/// (`burned_nanos`, the last reading of `pti_total_user` + `pti_total_system`).
/// Under the limit the signal is named and no limit is, so a kill the Owner
/// made is not reported as a limit the Runtime hit. `burned_nanos` is `None`
/// when the OS could not say. A kill this Runtime made for memory is not the
/// CPU's, so it answers nothing.
///
/// Under a cgroup scope the process this Runtime waits on is `systemd-run`,
/// which may report a failed scope — and a kill from the cgroup's own OOM — as
/// an exit code instead of a signal. An exit code names no limit here: only a
/// signal does, so such a kill can only be reported as a plain end. A non-zero
/// exit is never mislabelled as the CPU's.
pub fn breach(
    status: &ExitStatus,
    killed_for_memory: bool,
    burned_nanos: Option<u64>,
    soft_seconds: u64,
) -> Option<Cut> {
    if killed_for_memory {
        return None;
    }
    let reached_soft = burned_nanos
        .map(|burned| burned >= soft_seconds.saturating_mul(1_000_000_000))
        .unwrap_or(false);
    match signal_of(status)? {
        libc::SIGXCPU => Some(Cut::Limit {
            limit: CPU,
            signal: "SIGXCPU",
        }),
        libc::SIGKILL if reached_soft => Some(Cut::Limit {
            limit: CPU,
            signal: "SIGKILL",
        }),
        libc::SIGKILL => Some(Cut::Signal { signal: "SIGKILL" }),
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
/// before the OS kills it outright. Linux keeps it beside its cgroup scope,
/// where it is the backstop for a scope that could not be made.
#[cfg(unix)]
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
    task_info(pid).map(|info| info.pti_resident_size)
}

/// One worker's resident memory on Linux, from `/proc/<pid>/statm`: its second
/// number is the resident pages, which the page size turns into bytes.
#[cfg(target_os = "linux")]
pub fn resident_bytes(pid: u32) -> Option<u64> {
    resident_bytes_in(Path::new(PROC), pid)
}

/// The same reading, taken from `root` instead of `/proc`, so a test can stand
/// a fake `/proc` in for the real one (ADR 0022).
#[cfg(target_os = "linux")]
pub(crate) fn resident_bytes_in(root: &Path, pid: u32) -> Option<u64> {
    let text = std::fs::read_to_string(root.join(pid.to_string()).join("statm")).ok()?;
    let pages: u64 = text.split_whitespace().nth(1)?.parse().ok()?;
    Some(pages.saturating_mul(page_size()))
}

/// Where Linux keeps the running processes.
#[cfg(target_os = "linux")]
const PROC: &str = "/proc";

/// The bytes in one page of memory, which `/proc` counts in.
#[cfg(target_os = "linux")]
fn page_size() -> u64 {
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if size > 0 {
        size as u64
    } else {
        4_096
    }
}

/// The CPU time a process has burned so far, in nanoseconds, as the OS reports
/// it (`pti_total_user` + `pti_total_system`, both in nanoseconds).
#[cfg(target_os = "macos")]
pub fn cpu_nanos(pid: u32) -> Option<u64> {
    task_info(pid).map(|info| info.pti_total_user.saturating_add(info.pti_total_system))
}

/// The same on Linux, from `/proc/<pid>/stat`: `utime` and `stime` are the
/// process's own CPU time in clock ticks, so a `SIGKILL` can still be told
/// apart from the CPU limit (issue #47).
#[cfg(target_os = "linux")]
pub fn cpu_nanos(pid: u32) -> Option<u64> {
    cpu_nanos_in(Path::new(PROC), pid)
}

#[cfg(target_os = "linux")]
pub(crate) fn cpu_nanos_in(root: &Path, pid: u32) -> Option<u64> {
    let fields = stat_fields(root, pid)?;
    let user: u64 = fields.get(11)?.parse().ok()?;
    let system: u64 = fields.get(12)?.parse().ok()?;
    let ticks = user.saturating_add(system);
    let per_second = clock_ticks();
    Some(ticks.saturating_mul(1_000_000_000) / per_second)
}

/// How many clock ticks `/proc` counts CPU time in.
#[cfg(target_os = "linux")]
fn clock_ticks() -> u64 {
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks > 0 {
        ticks as u64
    } else {
        100
    }
}

/// The fields of `/proc/<pid>/stat` after the program's name. The name is in
/// parentheses and may hold spaces and parentheses of its own, so the split
/// starts at the last one; the rest are `state`, `ppid`, … (proc(5)).
#[cfg(target_os = "linux")]
fn stat_fields(root: &Path, pid: u32) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(root.join(pid.to_string()).join("stat")).ok()?;
    let rest = text.rsplit_once(')')?.1;
    Some(rest.split_whitespace().map(str::to_string).collect())
}

/// The process that started `pid`, from `/proc/<pid>/stat`.
#[cfg(target_os = "linux")]
fn parent_of(root: &Path, pid: u32) -> Option<u32> {
    // Read on its own rather than through `stat_fields`: the tree is walked for
    // every process on the Machine, every two seconds, so this one allocates
    // nothing it does not need.
    let text = std::fs::read_to_string(root.join(pid.to_string()).join("stat")).ok()?;
    let mut fields = text.rsplit_once(')')?.1.split_whitespace();
    fields.next()?; // the state
    fields.next()?.parse().ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn cpu_nanos(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
fn task_info(pid: u32) -> Option<libc::proc_taskinfo> {
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
    (read == size).then_some(info)
}

/// Ends a worker and every process below it. A worker's commands are its
/// children and outlive it, so killing only the worker would leave the runaway
/// command behind. On Linux this also matters when the worker was opened
/// through `systemd-run`, which is the process this Runtime holds: the worker
/// is below it, and killing the wrapper alone would leave the worker running.
#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    // `kill(0, …)` is every process in this group, which is the supervisor
    // itself: a child whose pid was never read is not killed at all.
    if pid == 0 {
        return;
    }
    kill_tree_with(pid, descendants, kill);
}

/// The order `kill_tree` works in, made a function of the two OS calls so a
/// test can stand a fake process tree in for the real one. Commands die before
/// the worker, so nothing below it starts another command once it is gone, and
/// the list is looked at once more while it is alive to catch what it started
/// between the first look and now. Every look is a snapshot: a grandchild that
/// starts after the last one escapes, and a pid in it may be reused before the
/// kill reaches it. That race is narrowed, not closed.
#[cfg(unix)]
pub(crate) fn kill_tree_with<D, K>(pid: u32, descendants_of: D, kill: K)
where
    D: Fn(u32) -> Vec<u32>,
    K: Fn(u32),
{
    let mut killed: Vec<u32> = Vec::new();
    for _ in 0..2 {
        for child in descendants_of(pid) {
            if child != pid && !killed.contains(&child) {
                killed.push(child);
                kill(child);
            }
        }
    }
    if !killed.contains(&pid) {
        killed.push(pid);
        kill(pid);
    }
    // Best effort once the worker is gone: the OS reparents its children as it
    // exits, so this usually finds none, and it costs nothing when it does.
    for child in descendants_of(pid) {
        if child != pid && !killed.contains(&child) {
            kill(child);
        }
    }
}

#[cfg(not(unix))]
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
#[cfg(unix)]
pub(crate) fn descendants(pid: u32) -> Vec<u32> {
    descendants_with(pid, children_of)
}

/// The walk `descendants` makes, made a function of one OS call so a test can
/// stand a fake process tree in for the real one.
#[cfg(unix)]
pub(crate) fn descendants_with<C>(pid: u32, children_of: C) -> Vec<u32>
where
    C: Fn(u32) -> Vec<u32>,
{
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

/// Every process whose parent is `pid`, read from `/proc`: a scan of the whole
/// table, because the kernel offers no cheaper list outside `/proc/<pid>/task`
/// (which needs CONFIG_PROC_CHILDREN).
#[cfg(target_os = "linux")]
fn children_of(pid: u32) -> Vec<u32> {
    children_in(Path::new(PROC), pid)
}

#[cfg(target_os = "linux")]
pub(crate) fn children_in(root: &Path, pid: u32) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut children: Vec<u32> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse::<u32>().ok())
        .filter(|candidate| parent_of(root, *candidate) == Some(pid))
        .collect();
    children.sort_unstable();
    children
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
                "limits": {
                    "cpuSeconds": 120,
                    "memoryMb": 512,
                    "cpuPercent": 150,
                    "tasks": 64,
                },
            })
            .to_string(),
        )
        .expect("config");
        assert_eq!(
            load(home.path()),
            Limits {
                cpu_seconds: 120,
                memory_mb: 512,
                cpu_percent: 150,
                tasks: 64,
            }
        );
        assert_eq!(Limits::default().cpu_percent, DEFAULT_CPU_PERCENT);
        assert_eq!(Limits::default().tasks, DEFAULT_TASKS);
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
            (
                json!({ "cpuPercent": 0, "tasks": 0 }),
                vec!["cpuPercent", "tasks"],
            ),
            (
                json!({ "cpuPercent": MAX_CPU_PERCENT + 1, "tasks": "many" }),
                vec!["cpuPercent", "tasks"],
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
        let soft = 120;
        // Injected totals: no process is really killed to check the rule.
        let burned = |seconds: u64| Some(seconds * 1_000_000_000);
        assert_eq!(
            breach(&status(libc::SIGXCPU), false, None, soft),
            Some(Cut::Limit {
                limit: CPU,
                signal: "SIGXCPU"
            })
        );
        assert_eq!(
            breach(&status(libc::SIGKILL), false, burned(soft + 60), soft),
            Some(Cut::Limit {
                limit: CPU,
                signal: "SIGKILL"
            }),
            "the hard RLIMIT_CPU is a SIGKILL, and the soft limit was used"
        );
        assert_eq!(
            breach(&status(libc::SIGKILL), false, burned(soft - 1), soft),
            Some(Cut::Signal { signal: "SIGKILL" }),
            "a kill -9 under the limit is not the CPU's"
        );
        assert_eq!(
            breach(&status(libc::SIGKILL), false, None, soft),
            Some(Cut::Signal { signal: "SIGKILL" }),
            "a SIGKILL nobody can attribute to the CPU names no limit"
        );
        assert_eq!(
            breach(&status(libc::SIGKILL), true, burned(soft * 2), soft),
            None,
            "a kill this Runtime made for memory is not the CPU's"
        );
        assert_eq!(
            breach(&status(libc::SIGTERM), false, burned(soft), soft),
            None
        );
        // `systemd-run` may report a scope's end as an exit code rather than a
        // signal, so the code is never read as one of our limits (issue #48).
        assert_eq!(
            breach(&ExitStatus::from_raw(1 << 8), false, burned(soft), soft),
            None,
            "an exit code names no limit"
        );
        assert_eq!(breach(&status(0), false, burned(soft), soft), None);
    }

    #[test]
    fn an_absurd_cpu_limit_falls_back_to_the_default() {
        let home = tempdir().expect("home");
        std::fs::write(
            home.path().join("config.json"),
            json!({ "limits": { "cpuSeconds": u64::MAX } }).to_string(),
        )
        .expect("config");
        assert_eq!(
            load(home.path()),
            Limits::default(),
            "a CPU limit setrlimit would refuse falls back"
        );
        let warnings: Vec<Value> = crate::logs::recent(home.path())
            .expect("logs")
            .iter()
            .map(|line| serde_json::from_str(line).expect("json"))
            .filter(|value: &Value| value["event"] == "limits.invalid")
            .collect();
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert_eq!(warnings[0]["level"], "warn");
        assert_eq!(warnings[0]["fields"]["field"], "cpuSeconds");
        // The largest sensible value is still read, not refused.
        let (limits, invalid) = read(Some(
            &json!({ "limits": { "cpuSeconds": MAX_CPU_SECONDS } }),
        ));
        assert_eq!(
            limits,
            Limits {
                cpu_seconds: MAX_CPU_SECONDS,
                ..Limits::default()
            }
        );
        assert!(invalid.is_empty(), "{invalid:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_workers_commands_are_killed_before_the_worker() {
        use std::cell::RefCell;

        // Three looks: the snapshot, the second look while the worker is alive
        // (which catches 12), and the one after it died (which catches 13).
        let looks = RefCell::new(vec![vec![10, 11], vec![11, 12], vec![12, 13]]);
        let ended = RefCell::new(Vec::new());
        kill_tree_with(
            7,
            |_pid| looks.borrow_mut().remove(0),
            |pid| ended.borrow_mut().push(pid),
        );
        assert_eq!(
            *ended.borrow(),
            vec![10, 11, 12, 7, 13],
            "commands first, the worker next, and no pid twice"
        );
    }

    /// A pid this Runtime never read is not `kill(0)`, which is every process
    /// in this group — the supervisor itself.
    #[cfg(unix)]
    #[test]
    fn a_pid_that_was_never_read_is_not_killed() {
        kill_tree(0);
    }

    /// Writes one process into a fake `/proc`: its parent, its own CPU time in
    /// clock ticks, and its resident pages. The name holds spaces and
    /// parentheses, as a real one may.
    #[cfg(target_os = "linux")]
    fn write_proc_process(root: &Path, pid: u32, ppid: u32, ticks: (u64, u64), pages: u64) {
        let dir = root.join(pid.to_string());
        std::fs::create_dir_all(&dir).expect("process dir");
        std::fs::write(
            dir.join("stat"),
            format!(
                "{pid} (a worker (with parens)) S {ppid} 0 0 0 0 0 0 0 0 0 {} {} 0 0",
                ticks.0, ticks.1
            ),
        )
        .expect("stat");
        std::fs::write(dir.join("statm"), format!("1000 {pages} 10 1 0 20 0")).expect("statm");
    }

    /// The readings a Linux Machine uses (issue #48): resident pages from
    /// `statm`, CPU ticks from `stat`, and the process tree from every
    /// process's parent. A fake `/proc` stands in for the real one.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_memory_cpu_and_process_tree_are_read_from_proc() {
        let root = tempdir().expect("proc");
        write_proc_process(root.path(), 100, 1, (3, 2), 25);
        write_proc_process(root.path(), 101, 100, (0, 0), 4);
        write_proc_process(root.path(), 102, 101, (0, 0), 1);
        write_proc_process(root.path(), 103, 1, (0, 0), 1);

        assert_eq!(
            resident_bytes_in(root.path(), 100),
            Some(25 * page_size()),
            "resident pages become bytes"
        );
        assert_eq!(resident_bytes_in(root.path(), 999), None);

        assert_eq!(children_in(root.path(), 100), vec![101]);
        assert_eq!(
            descendants_with(100, |pid| children_in(root.path(), pid)),
            vec![101, 102],
            "the worker's commands and theirs, and nothing else"
        );

        assert_eq!(
            cpu_nanos_in(root.path(), 100),
            Some(5 * 1_000_000_000 / clock_ticks()),
            "utime and stime, in nanoseconds"
        );
        assert_eq!(cpu_nanos_in(root.path(), 999), None);
    }

    /// The real `/proc` says something about a process that is really here.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_live_process_reads_its_own_memory_and_time() {
        let pid = std::process::id();
        let bytes = resident_bytes(pid).expect("the kernel reports this process");
        assert!(bytes > 0, "a running process holds some memory");
        assert!(
            cpu_nanos(pid).is_some(),
            "the kernel reports this process's CPU time"
        );
    }

    /// The reading the classifier trusts: this process's own CPU time, from the
    /// same call the RSS monitor makes. macOS only: `/proc` counts CPU in clock
    /// ticks, so a test this short may legitimately have burned none of them.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_cpu_a_process_burned_is_read_from_the_os() {
        let burned = cpu_nanos(std::process::id()).expect("the OS reports its own CPU time");
        assert!(burned > 0, "a running process has burned some CPU");
    }

    /// The real thing: a busy child with `RLIMIT_CPU` is stopped by the OS.
    #[cfg(unix)]
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

    /// The real `/proc` answers the same question as the fake one: a child this
    /// test started is found below it, which is what the watch walks so a
    /// command's memory counts against its worker (issue #48).
    #[cfg(target_os = "linux")]
    #[test]
    fn a_real_child_is_found_below_its_parent_in_proc() {
        use std::time::{Duration, Instant};

        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 30 & sleep 30"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("a worker with commands");
        let end = Instant::now() + Duration::from_secs(5);
        let mut found = Vec::new();
        while Instant::now() < end {
            found = descendants(child.id());
            if !found.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        kill_tree(child.id());
        let _ = child.wait();
        assert!(
            !found.is_empty(),
            "the command below the worker was not found in /proc"
        );
    }

    /// A command a worker starts is the worker's child, and it would outlive
    /// the worker if only the worker were killed. macOS only: a container's
    /// PID 1 need not reap what the kill orphans, so the waits there would see
    /// zombies rather than gone processes.
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
