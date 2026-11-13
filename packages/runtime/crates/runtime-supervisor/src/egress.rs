//! Each Agent's own Egress (ADR 0029, issue #43), ported from
//! `packages/runtime-legacy/src/supervisor/egress/egress.ts`.
//!
//! No file is an empty list, and an empty list lets no Agent out. A file that
//! does not hold a list of domains opens nothing.
//!
//! The list lives in the Agent's own row in `agents.json`; the old Machine-wide
//! `runtime/egress.json` is copied to every Agent exactly once, through a flag
//! file next to it, and after that is only a union view for a Controller that
//! still reads one list.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};

use veeloe_protocol::messages::message_is_valid;

use crate::agents::{AgentError, AgentRegistry};
use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

/// The legacy Machine-wide list, kept as the union view (ADR 0029).
const FILE: &str = "egress.json";

/// Beside the legacy file once its list has been copied to every Agent, so a
/// restart never copies it a second time (the shape `usage.json.migrated` has).
const MIGRATED: &str = "egress.json.migrated";

#[derive(Debug, thiserror::Error)]
pub enum EgressError {
    #[error("{0}")]
    File(String),
}

impl From<JsonFileError> for EgressError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for EgressError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<AgentError> for EgressError {
    fn from(error: AgentError) -> Self {
        Self::File(error.to_string())
    }
}

/// Whether this is a list of domains the Protocol accepts. The same check every
/// `egress.set` goes through.
pub fn is_valid_egress(domains: &[String]) -> bool {
    message_is_valid("egress.set", &json!({ "egress": domains })) == Some(true)
}

/// The legacy Machine-wide list. Read only to migrate it; every other reader
/// asks [`Egress::current`] for one Agent.
pub fn load_egress(home: &Path) -> Result<Vec<String>, EgressError> {
    let file = supervisor_dir(home)?.join(FILE);
    let Some(value) = read_json_file(&file)? else {
        return Ok(Vec::new());
    };
    let domains: Vec<String> = value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if !is_valid_egress(&domains) {
        return Ok(Vec::new());
    }
    Ok(dedupe(domains))
}

/// Every Agent's Egress, held in one place so a proxy can ask what its own
/// Agent may reach on each connection, and `egress.set` takes effect without
/// starting a worker again.
///
/// The Agent's row in `agents.json` is the source of truth; this is a mirror
/// opened with the supervisor and written through on every change. An Agent
/// this handle never saw — one created after it opened — reads as empty, which
/// is what a new Agent starts with.
pub struct Egress {
    home: std::path::PathBuf,
    current: Mutex<HashMap<String, Vec<String>>>,
}

impl Egress {
    /// Opens the Agents' lists, after copying the old Machine-wide one to every
    /// Agent if that has not happened yet (ADR 0069, issue #43).
    pub fn open(home: &Path) -> Result<Self, EgressError> {
        let registry = AgentRegistry::open(home)?;
        migrate_legacy(home, &registry)?;
        let current = registry
            .all()?
            .into_iter()
            .map(|agent| (agent.id, agent.egress))
            .collect();
        Ok(Self {
            home: home.to_path_buf(),
            current: Mutex::new(current),
        })
    }

    /// What this Agent itself may reach. An Agent this handle has never heard
    /// of gets nothing, never another Agent's list (ADR 0029).
    pub fn current(&self, agent: &str) -> Vec<String> {
        self.current
            .lock()
            .expect("egress")
            .get(agent)
            .cloned()
            .unwrap_or_default()
    }

    /// Forgets what an id had, for an Agent that was created again after its
    /// old row was purged: the new Agent starts with no way out, never with the
    /// list of the Agent that used the id before it (issue #43).
    pub fn forget(&self, agent: &str) {
        self.current.lock().expect("egress").remove(agent);
    }

    /// The whole new list for one Agent, already checked against the Protocol's
    /// schema. `None` when the list is not one, or this Machine has no such
    /// Agent: the proxy keeps what it had.
    ///
    /// The read, the write of `agents.json` and the union view, and the mirror
    /// all happen under the one lock, so this cannot lose a domain an `always`
    /// added at the same moment (issue #44).
    pub fn set_agent(
        &self,
        agent: &str,
        domains: Vec<String>,
    ) -> Result<Option<Vec<String>>, EgressError> {
        if !is_valid_egress(&domains) {
            return Ok(None);
        }
        let next = dedupe(domains);
        let mut current = self.current.lock().expect("egress");
        self.write_agent(&mut current, agent, next)
    }

    /// Adds one domain to this Agent's list, in one write, for a permanent yes
    /// on an Approval (issue #44). `None` when the domain is not one, or this
    /// Machine has no such Agent: the approval then stays unanswered rather
    /// than promising a way out that was never written.
    ///
    /// The read and the write happen under the same lock as [`Egress::current`],
    /// [`Egress::set_agent`] and [`Egress::set_all`], so two permanent yeses at
    /// once — or one at the same moment as an `egress.set` — cannot lose one of
    /// the writes.
    pub fn add_domain(
        &self,
        agent: &str,
        domain: &str,
    ) -> Result<Option<Vec<String>>, EgressError> {
        if !is_valid_egress(std::slice::from_ref(&domain.to_string())) {
            return Ok(None);
        }
        let mut current = self.current.lock().expect("egress");
        let mut next = current.get(agent).cloned().unwrap_or_default();
        if !next.iter().any(|known| known == domain) {
            next.push(domain.to_string());
        }
        self.write_agent(&mut current, agent, next)
    }

    /// The whole new list for every Agent: the legacy `egress.set` without an
    /// Agent, until the Controller has a per-Agent screen. Also how the
    /// migration brings the old Machine list across. Holds the same lock as the
    /// other two writers for the whole read and write (issue #44).
    pub fn set_all(&self, domains: Vec<String>) -> Result<Option<Vec<String>>, EgressError> {
        if !is_valid_egress(&domains) {
            return Ok(None);
        }
        let next = dedupe(domains);
        let mut current = self.current.lock().expect("egress");
        let registry = AgentRegistry::open(&self.home)?;
        registry.set_egress_everywhere(&next)?;
        let agents = registry.all()?;
        for agent in agents {
            current.insert(agent.id, next.clone());
        }
        // A new Agent starts with an empty list, not this one; nothing is
        // remembered for ids that do not exist yet (issue #43).
        write_union(&self.home, &registry)?;
        Ok(Some(next))
    }

    /// Writes one Agent's whole list while the caller holds the lock: the row
    /// in `agents.json`, the union view a Controller still reads, and the
    /// mirror. One lock covers the read, the write and the assign, which is
    /// what keeps a permanent yes and an `egress.set` that arrive together from
    /// writing one over the other (issue #44).
    fn write_agent(
        &self,
        current: &mut HashMap<String, Vec<String>>,
        agent: &str,
        next: Vec<String>,
    ) -> Result<Option<Vec<String>>, EgressError> {
        let registry = AgentRegistry::open(&self.home)?;
        if !registry.set_egress(agent, &next)? {
            return Ok(None);
        }
        current.insert(agent.to_string(), next.clone());
        write_union(&self.home, &registry)?;
        Ok(Some(next))
    }
}

/// Copies the old Machine-wide list to every Agent, once. The flag is written
/// even when there is no old file, so a later start never takes a list written
/// after this change for an old one. A broken old file copies nothing: it never
/// opened anything before either.
fn migrate_legacy(home: &Path, registry: &AgentRegistry) -> Result<(), EgressError> {
    let dir = supervisor_dir(home)?;
    let flag = dir.join(MIGRATED);
    if flag.exists() {
        return Ok(());
    }
    // No old file means there is no old list to copy: the Agents keep whatever
    // their own rows say, and a new Agent still starts empty (issue #43).
    if !dir.join(FILE).exists() {
        write_json_file(&flag, &json!({ "agents": 0 }))?;
        return Ok(());
    }
    let domains = load_egress(home)?;
    let count = registry.set_egress_everywhere(&domains)?;
    write_json_file(&flag, &json!({ "agents": count }))?;
    write_union(home, registry)?;
    Ok(())
}

/// `egress.json` as the union of every Agent's list, for a Controller that has
/// not moved to per-Agent Egress yet (issue #43).
fn write_union(home: &Path, registry: &AgentRegistry) -> Result<(), EgressError> {
    let mut union: Vec<String> = Vec::new();
    for agent in registry.all()? {
        for domain in agent.egress {
            if !union.contains(&domain) {
                union.push(domain);
            }
        }
    }
    write_json_file(
        &supervisor_dir(home)?.join(FILE),
        &Value::Array(union.iter().cloned().map(Value::String).collect()),
    )?;
    Ok(())
}

fn dedupe(domains: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for domain in domains {
        if !out.contains(&domain) {
            out.push(domain);
        }
    }
    out
}
