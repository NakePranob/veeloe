//! The localhost ports one Agent may listen on, and nobody else's (ADR 0069).
//!
//! Seatbelt cannot hand out a network namespace, so the only way macOS can give
//! each Agent a localhost of its own is to give each one a range of ports and
//! allow exactly those in its profile. The range is reserved once and kept in
//! `<VEELOE_HOME>/runtime/ports.json`, outside the folder the Agent can write,
//! so the same range comes back after a restart and two Agents never share one.
//!
//! A range is ten ports, always starting on a multiple of ten between
//! `FIRST` and `LAST`, and never covering the Egress proxy's port: the proxy is
//! the one way out, and a command reaching it is not a command reaching a host
//! service.

use std::collections::BTreeMap;
use std::fs::File;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::logs;
use crate::trust::{supervisor_dir, TrustError};

/// How many ports an Agent gets: enough for a dev server, a database and a
/// cache beside it, small enough that a Machine with many Agents still fits.
pub const COUNT: u16 = 10;

/// The first port a range may start on, and the last port one may reach.
pub const FIRST: u16 = 20_000;
pub const LAST: u16 = 60_000;

/// Ranges are spaced so a person reading a port number can tell which Agent it
/// belongs to.
const STEP: u16 = 10;

const FILE: &str = "ports.json";

/// Beside the file it guards: the lock lives as long as this process holds it,
/// and the file itself is never read.
const LOCK: &str = "ports.lock";

/// One allocation at a time across the process, so two workers that start
/// together in one supervisor do not both read the file, both find the same
/// free range and both keep it. Another supervisor is kept out by the OS lock
/// below, which is held across the read and the write.
static ALLOCATING: Mutex<()> = Mutex::new(());

/// The OS lock that keeps two supervisors apart. The mutex only orders the
/// threads of this process; a restart that starts the new supervisor before the
/// old one has closed its files, or a supervisor started by hand beside the
/// service, would otherwise read the file at the same moment and hand out the
/// same range. `flock` is released by the kernel when the file closes, however
/// the process ends.
struct AllocationLock {
    file: File,
}

impl AllocationLock {
    fn take(dir: &Path) -> Result<Self, PortsError> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(dir.join(LOCK))
            .map_err(|error| {
                PortsError::File(format!("cannot open {}: {error}", dir.join(LOCK).display()))
            })?;
        loop {
            // `LOCK_EX` waits, so a second supervisor allocates after the first
            // has written, not beside it.
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                return Ok(Self { file });
            }
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(PortsError::File(format!(
                "cannot lock {}: {error}",
                dir.join(LOCK).display()
            )));
        }
    }
}

impl Drop for AllocationLock {
    fn drop(&mut self) {
        // Closing the file would release the lock too; saying so first keeps
        // the intent visible next to the `take` that made it.
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PortsError {
    #[error("{0}")]
    File(String),
    #[error("no range of {COUNT} ports is left to give an Agent")]
    Exhausted,
}

impl From<JsonFileError> for PortsError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for PortsError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// The ports an Agent may use, in order: `start .. start + COUNT`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    start: u16,
}

impl Range {
    /// The first port of the range, which the worker gets as `PORT`.
    pub fn start(&self) -> u16 {
        self.start
    }

    pub fn ports(&self) -> Vec<u16> {
        (self.start..self.start + COUNT).collect()
    }

    pub fn contains(&self, port: u16) -> bool {
        (self.start..self.start + COUNT).contains(&port)
    }

    /// The range as one command sees it: `VEELOE_PORTS`.
    pub fn listed(&self) -> String {
        self.ports()
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(",")
    }
}

/// The reserved ranges, as `ports.json` holds them: one first port per Agent.
pub struct Ports {
    home: PathBuf,
    assigned: BTreeMap<String, u16>,
    /// Why the file could not be read, when it exists and is corrupt: the
    /// supervisor starts with no reservations rather than not at all, and the
    /// next allocation rewrites the file.
    unreadable: Option<String>,
}

impl Ports {
    /// What the file holds now. A file that cannot be read or parsed is
    /// reported at Runtime log level and read as empty: refusing to start would
    /// take every Agent down with one bad file, and the next allocation writes
    /// a fresh one (issue #42).
    pub fn open(home: &Path) -> Result<Self, PortsError> {
        let dir = supervisor_dir(home)?;
        let (assigned, unreadable) = load(&dir);
        let ports = Self {
            home: home.to_path_buf(),
            assigned,
            unreadable,
        };
        note_unreadable(home, ports.unreadable.as_deref());
        Ok(ports)
    }

    /// Why the file was read as empty, if it was. The caller prints it; the
    /// Runtime log already holds it.
    pub fn warning(&self) -> Option<&str> {
        self.unreadable.as_deref()
    }

    /// Whether a port is inside some Agent's range.
    pub fn is_taken(&self, port: u16) -> bool {
        self.assigned
            .values()
            .any(|start| (*start..*start + COUNT).contains(&port))
    }

    /// This Agent's range: the one it already has, or a new one written down
    /// before it is used. `exclude` is a port this run must not cover, such as
    /// an Egress proxy's.
    ///
    /// The answer is the same on every call and after a restart, because the
    /// first answer is the one in the file.
    pub fn range(&self, agent: &str, exclude: Option<u16>) -> Result<Range, PortsError> {
        self.range_avoiding(agent, &|port| exclude == Some(port))
    }

    /// The same, for a set of ports that is not one number: every Agent's proxy
    /// is on a port no range may cover, so a command never binds the way out
    /// (ADR 0069, issue #43).
    pub fn range_avoiding(
        &self,
        agent: &str,
        avoid: &(dyn Fn(u16) -> bool + Send + Sync),
    ) -> Result<Range, PortsError> {
        let _allocating = ALLOCATING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let dir = supervisor_dir(&self.home)?;
        let _locked = AllocationLock::take(&dir)?;
        // Read again under the lock: another `Ports` may have written a range
        // since this one was opened.
        let (mut assigned, unreadable) = load(&dir);
        // The file went bad after `open`, or this handle never saw it: same
        // answer, same warning.
        note_unreadable(&self.home, unreadable.as_deref());
        if let Some(start) = assigned.get(agent) {
            return Ok(Range { start: *start });
        }
        let start = first_free(&assigned, avoid).ok_or(PortsError::Exhausted)?;
        assigned.insert(agent.to_string(), start);
        save(&dir, &assigned)?;
        Ok(Range { start })
    }

    /// The range this Agent already has in the file, or `None` when none is
    /// reserved. Unlike [`Ports::range`] this never allocates or writes: the
    /// worker reads back what `rules()` just reserved, and a second write would
    /// be a second chance to lose it.
    pub fn existing(&self, agent: &str) -> Option<Range> {
        let dir = supervisor_dir(&self.home).ok()?;
        let (assigned, unreadable) = load(&dir);
        note_unreadable(&self.home, unreadable.as_deref());
        assigned
            .get(agent)
            .map(|start| Range { start: *start })
    }
}

/// Report a file that was read as empty, at Runtime log level. Content-free:
/// the path and the parser's words, never a Task's.
fn note_unreadable(home: &Path, reason: Option<&str>) {
    let Some(reason) = reason else {
        return;
    };
    let _ = logs::record(
        home,
        "warn",
        "runtime.ports_unreadable",
        serde_json::json!({ "reason": reason }),
    );
}

/// The lowest range that overlaps no reservation and covers no avoided port.
fn first_free(
    assigned: &BTreeMap<String, u16>,
    avoid: &(dyn Fn(u16) -> bool + Send + Sync),
) -> Option<u16> {
    let mut start = FIRST;
    while start + COUNT <= LAST {
        let overlaps = assigned
            .values()
            .any(|other| start < other + COUNT && *other < start + COUNT);
        let covers_avoided = (start..start + COUNT).any(avoid);
        if !overlaps && !covers_avoided {
            return Some(start);
        }
        start += STEP;
    }
    None
}

/// The reservations in `dir`, and why they were read as none when the file is
/// there but unusable. A missing file is simply no reservations yet.
fn load(dir: &Path) -> (BTreeMap<String, u16>, Option<String>) {
    let file = dir.join(FILE);
    let value = match read_json_file(&file) {
        Ok(Some(value)) => value,
        Ok(None) => return (BTreeMap::new(), None),
        Err(error) => return (BTreeMap::new(), Some(error.to_string())),
    };
    let mut assigned: BTreeMap<String, u16> = BTreeMap::new();
    let Some(entries) = value.as_object() else {
        // A file of the wrong shape is the same accident as an unparseable one.
        return (
            assigned,
            Some(format!(
                "{} does not hold one port per Agent",
                file.display()
            )),
        );
    };
    for (agent, start) in entries {
        let Some(start) = start.as_u64().and_then(|port| u16::try_from(port).ok()) else {
            continue;
        };
        if !is_start(start) {
            continue;
        }
        // A file edited by hand can hold the same range twice. Keep the first
        // and leave the other Agent to be given a new one, so two Agents never
        // share a range because of it.
        if assigned.values().any(|other| overlaps(*other, start)) {
            continue;
        }
        assigned.insert(agent.clone(), start);
    }
    (assigned, None)
}

fn save(dir: &Path, assigned: &BTreeMap<String, u16>) -> Result<(), PortsError> {
    let mut entries = Map::new();
    for (agent, start) in assigned {
        entries.insert(agent.clone(), Value::from(*start));
    }
    write_json_file(&dir.join(FILE), &Value::Object(entries))?;
    Ok(())
}

fn is_start(start: u16) -> bool {
    start >= FIRST && start % STEP == 0 && start + COUNT <= LAST
}

fn overlaps(a: u16, b: u16) -> bool {
    a < b + COUNT && b < a + COUNT
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn range_of(home: &Path, agent: &str, exclude: Option<u16>) -> Range {
        Ports::open(home)
            .expect("ports")
            .range(agent, exclude)
            .expect("range")
    }

    #[test]
    fn two_agents_never_share_a_range() {
        let home = tempdir().expect("home");
        let first = range_of(home.path(), "a1", None);
        let second = range_of(home.path(), "a2", None);
        assert_eq!(first.ports().len() as u16, COUNT);
        assert!(!first.ports().iter().any(|port| second.contains(*port)));
        assert!(!second.ports().iter().any(|port| first.contains(*port)));

        // A third gets its own again, and the file holds one first port each.
        let third = range_of(home.path(), "a3", None);
        assert!(!third.ports().iter().any(|port| {
            first.contains(*port) || second.contains(*port)
        }));
        let file = std::fs::read_to_string(home.path().join("runtime/ports.json"))
            .expect("ports.json");
        let value: Value = serde_json::from_str(&file).expect("json");
        assert_eq!(value.as_object().map(|entries| entries.len()), Some(3));
    }

    #[test]
    fn the_same_range_comes_back_after_a_restart() {
        let home = tempdir().expect("home");
        let before = range_of(home.path(), "a1", None);
        // A new supervisor opens the file again; nothing is allocated twice.
        let reopened = Ports::open(home.path()).expect("ports");
        let after = reopened.range("a1", None).expect("range");
        assert_eq!(before, after);
        // And a second Agent started after the restart does not take it.
        let other = reopened.range("a2", None).expect("range");
        assert!(!other.ports().iter().any(|port| before.contains(*port)));
    }

    #[test]
    fn no_range_covers_the_egress_proxy_port() {
        let home = tempdir().expect("home");
        let proxy = FIRST + 5;
        let range = range_of(home.path(), "a1", Some(proxy));
        assert!(!range.contains(proxy), "{range:?} covers the proxy's port");
        // The next Agent avoids both the first range and the proxy.
        let second = range_of(home.path(), "a2", Some(proxy));
        assert!(!second.contains(proxy));
        assert!(!range.ports().iter().any(|port| second.contains(*port)));
    }

    #[test]
    fn a_range_is_ten_ports_on_a_multiple_of_ten() {
        let home = tempdir().expect("home");
        let range = range_of(home.path(), "a1", None);
        assert_eq!(range.start(), FIRST);
        assert_eq!(range.listed().split(',').count() as u16, COUNT);
        assert_eq!(range.listed().split(',').next(), Some("20000"));
        assert_eq!(range.start() % STEP, 0);
    }

    #[test]
    fn a_file_that_holds_the_same_range_twice_gives_the_second_agent_another() {
        let home = tempdir().expect("home");
        std::fs::create_dir_all(home.path().join("runtime")).expect("runtime");
        std::fs::write(
            home.path().join("runtime/ports.json"),
            r#"{"a1":20000,"a2":20000}"#,
        )
        .expect("ports.json");
        let ports = Ports::open(home.path()).expect("ports");
        let second = ports.range("a2", None).expect("range");
        assert_ne!(second.start(), 20000);
        assert!(!second.contains(20000));
    }

    #[test]
    fn a_file_holding_ports_outside_the_window_is_not_trusted() {
        let home = tempdir().expect("home");
        std::fs::create_dir_all(home.path().join("runtime")).expect("runtime");
        std::fs::write(
            home.path().join("runtime/ports.json"),
            r#"{"a1":80,"a2":"nope"}"#,
        )
        .expect("ports.json");
        let range = range_of(home.path(), "a1", None);
        assert!(range.start() >= FIRST, "{range:?}");
    }

    /// Issue #42: one bad file must not take every Agent down. The supervisor
    /// reads nothing, says so at Runtime log level, and the next allocation
    /// writes a file that reads again.
    #[test]
    fn a_corrupt_file_is_reported_and_rewritten_by_the_next_allocation() {
        let home = tempdir().expect("home");
        std::fs::create_dir_all(home.path().join("runtime")).expect("runtime");
        std::fs::write(home.path().join("runtime/ports.json"), "{not json").expect("ports.json");
        let ports = Ports::open(home.path()).expect("the supervisor still starts");
        assert!(ports.warning().is_some(), "the corruption went unreported");
        let range = ports.range("a1", None).expect("range");
        assert_eq!(range.start(), FIRST);
        // The file is whole again, so the next start keeps this range.
        let file = std::fs::read_to_string(home.path().join("runtime/ports.json"))
            .expect("ports.json");
        let value: Value = serde_json::from_str(&file).expect("rewritten json");
        assert_eq!(
            value.get("a1").and_then(Value::as_u64),
            Some(u64::from(FIRST))
        );
        // And the Runtime log holds the warning, not just the return value.
        let logged = logs::recent(home.path()).expect("logs");
        assert!(
            logged.iter().any(|line| line.contains("runtime.ports_unreadable")),
            "{logged:?}"
        );
        // The same range is handed back after the rewrite.
        let reopened = Ports::open(home.path()).expect("ports");
        assert_eq!(reopened.existing("a1"), Some(range));
    }

    /// Issue #42: reading back the range a worker was wrapped with must not
    /// allocate or write. A second write is a second chance to lose it.
    #[test]
    fn existing_reads_without_allocating() {
        let home = tempdir().expect("home");
        let ports = Ports::open(home.path()).expect("ports");
        assert_eq!(ports.existing("a1"), None);
        assert!(
            !home.path().join("runtime/ports.json").exists(),
            "a read wrote the file"
        );
        let reserved = ports.range("a1", None).expect("range");
        assert_eq!(ports.existing("a1"), Some(reserved));
        assert_eq!(ports.existing("a2"), None);
    }

    /// Issue #42: the in-process mutex cannot order two supervisors. A second
    /// handle to the lock file must wait for the first, which is what keeps a
    /// restart from handing the same range out twice.
    #[test]
    fn an_allocation_waits_for_the_os_lock_held_through_another_handle() {
        use std::sync::mpsc;
        use std::time::Duration;

        let home = tempdir().expect("home");
        let dir = home.path().join("runtime");
        std::fs::create_dir_all(&dir).expect("runtime");
        let held = AllocationLock::take(&dir).expect("lock");
        let path = home.path().to_path_buf();
        let (sent, received) = mpsc::channel();
        let allocating = std::thread::spawn(move || {
            let range = Ports::open(&path).expect("ports").range("a1", None);
            sent.send(range.is_ok()).expect("send");
        });
        assert!(
            received
                .recv_timeout(Duration::from_millis(200))
                .is_err(),
            "the allocation did not wait for the OS lock"
        );
        drop(held);
        assert!(
            received
                .recv_timeout(Duration::from_secs(5))
                .expect("the allocation finished once the lock was free"),
            "the allocation failed"
        );
        allocating.join().expect("thread");
        let ports = Ports::open(home.path()).expect("ports");
        assert!(ports.existing("a1").is_some());
    }
}
