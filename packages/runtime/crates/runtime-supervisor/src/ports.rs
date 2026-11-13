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
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
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

/// One allocation at a time across the process: two workers that start together
/// must not both read the file, both find the same free range and both keep it.
/// The lock is held across the read and the write, which is the whole point.
static ALLOCATING: Mutex<()> = Mutex::new(());

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
    home: std::path::PathBuf,
    assigned: BTreeMap<String, u16>,
}

impl Ports {
    /// What the file holds now. A file that cannot be read or parsed is an
    /// error, never an empty answer: an Agent that silently lost its range
    /// would lose its services with it.
    pub fn open(home: &Path) -> Result<Self, PortsError> {
        Ok(Self {
            home: home.to_path_buf(),
            assigned: load(home)?,
        })
    }

    /// Whether a port is inside some Agent's range.
    pub fn is_taken(&self, port: u16) -> bool {
        self.assigned
            .values()
            .any(|start| (*start..*start + COUNT).contains(&port))
    }

    /// This Agent's range: the one it already has, or a new one written down
    /// before it is used. `exclude` is the port the Egress proxy listens on
    /// this run, which no range may cover.
    ///
    /// The answer is the same on every call and after a restart, because the
    /// first answer is the one in the file.
    pub fn range(&self, agent: &str, exclude: Option<u16>) -> Result<Range, PortsError> {
        let _allocating = ALLOCATING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Read again under the lock: another `Ports` may have written a range
        // since this one was opened.
        let mut assigned = load(&self.home)?;
        if let Some(start) = assigned.get(agent) {
            return Ok(Range { start: *start });
        }
        let start = first_free(&assigned, exclude).ok_or(PortsError::Exhausted)?;
        assigned.insert(agent.to_string(), start);
        save(&self.home, &assigned)?;
        Ok(Range { start })
    }
}

/// The lowest range that overlaps no reservation and covers no excluded port.
fn first_free(assigned: &BTreeMap<String, u16>, exclude: Option<u16>) -> Option<u16> {
    let mut start = FIRST;
    while start + COUNT <= LAST {
        let overlaps = assigned
            .values()
            .any(|other| start < other + COUNT && *other < start + COUNT);
        let covers_excluded = exclude.is_some_and(|port| (start..start + COUNT).contains(&port));
        if !overlaps && !covers_excluded {
            return Some(start);
        }
        start += STEP;
    }
    None
}

fn load(home: &Path) -> Result<BTreeMap<String, u16>, PortsError> {
    let file = supervisor_dir(home)?.join(FILE);
    let Some(value) = read_json_file(&file)? else {
        return Ok(BTreeMap::new());
    };
    let mut assigned: BTreeMap<String, u16> = BTreeMap::new();
    let Some(entries) = value.as_object() else {
        return Ok(assigned);
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
    Ok(assigned)
}

fn save(home: &Path, assigned: &BTreeMap<String, u16>) -> Result<(), PortsError> {
    let mut entries = Map::new();
    for (agent, start) in assigned {
        entries.insert(agent.clone(), Value::from(*start));
    }
    write_json_file(
        &supervisor_dir(home)?.join(FILE),
        &Value::Object(entries),
    )?;
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
}
