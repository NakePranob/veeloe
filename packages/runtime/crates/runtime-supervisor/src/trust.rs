//! The Machine's identity and who it takes commands from, ported from
//! `packages/runtime-legacy/src/supervisor/trust/` and `config.ts`.
//!
//! The key is an Ed25519 seed in `machine.key`, readable and writable by the
//! owner only (ADR 0012, 0013). `trust.json` is the list of keys this Machine
//! obeys (ADR 0031); `seen.json` is the last sequence number per key, so a
//! replay is still a replay after a restart.

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use veeloe_protocol::envelope::SeenSequences;
use veeloe_protocol::hub_auth::normalize_hub_url;

use crate::json_file::{read_json_file, write_atomic_bytes, write_json_file, JsonFileError};

#[derive(Debug, thiserror::Error)]
pub enum TrustError {
    #[error("{0}")]
    Key(String),
    #[error("{0}")]
    File(String),
    #[error("hub: {0}")]
    Hub(String),
}

impl From<JsonFileError> for TrustError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

/// The Runtime's folder: `runtime/` inside the home, created owner-only. Files
/// from before the folder existed are moved into it.
pub fn supervisor_dir(home: &Path) -> Result<PathBuf, TrustError> {
    let dir = home.join("runtime");
    fs::create_dir_all(&dir).map_err(|error| TrustError::File(error.to_string()))?;
    let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    for name in ["trust.json", "seen.json"] {
        let old = home.join(name);
        let new = dir.join(name);
        if old.exists() && !new.exists() {
            let _ = fs::rename(&old, &new);
        }
    }
    Ok(dir)
}

/// The Machine's identity: created on the first start, reused on every one
/// after. The Runtime will not run on a key others can read.
pub fn load_or_create_machine_key(home: &Path) -> Result<[u8; 32], TrustError> {
    let file = home.join("machine.key");
    if !file.exists() {
        let mut key = [0u8; 32];
        getrandom(&mut key);
        // Raw bytes, the way the legacy Runtime wrote it, so one home folder
        // works for both.
        write_atomic_bytes(&file, &key, 0o600)
            .map_err(|error| TrustError::Key(error.to_string()))?;
    }
    let mode = fs::metadata(&file)
        .map_err(|error| TrustError::Key(error.to_string()))?
        .permissions()
        .mode()
        & 0o777;
    if mode & 0o077 != 0 {
        return Err(TrustError::Key(format!(
            "{} is open to other users (mode {:o}); it must be 600 — run: chmod 600 {}",
            file.display(),
            mode,
            file.display()
        )));
    }
    let bytes = fs::read(&file).map_err(|error| TrustError::Key(error.to_string()))?;
    if bytes.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }
    // A key this port wrote as text, before it matched the legacy file.
    let text = String::from_utf8_lossy(&bytes);
    from_hex(text.trim())
        .ok_or_else(|| TrustError::Key(format!("{} is not a 32-byte key", file.display())))
}

/// The name this Machine pairs with: its host name, without `.local`.
pub fn machine_name() -> String {
    let mut buffer = [0u8; 256];
    let name = unsafe {
        if libc::gethostname(buffer.as_mut_ptr() as *mut libc::c_char, buffer.len()) == 0 {
            let end = buffer
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(buffer.len());
            String::from_utf8_lossy(&buffer[..end]).to_string()
        } else {
            "machine".to_string()
        }
    };
    name.strip_suffix(".local").unwrap_or(&name).to_string()
}

/// The Hub URL is `hubUrl` in the folder's `config.json`, and VEELOE_HUB_URL
/// overrides it.
pub fn save_hub_url(home: &Path, hub_url: &str) -> Result<(), TrustError> {
    let normalized =
        normalize_hub_url(hub_url).map_err(|error| TrustError::Hub(error.to_string()))?;
    write_json_file(&home.join("config.json"), &json!({ "hubUrl": normalized }))?;
    Ok(())
}

/// The Hub URL this Machine was paired to: `hubUrl` in `config.json`, with
/// VEELOE_HUB_URL overriding it. `None` when neither names one.
pub fn load_hub_url(home: &Path) -> Option<String> {
    if let Ok(url) = std::env::var("VEELOE_HUB_URL") {
        return Some(url);
    }
    let value = read_json_file(&home.join("config.json")).ok()??;
    value.get("hubUrl")?.as_str().map(str::to_string)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub member: String,
    pub keys: Vec<String>,
}

/// What a Member may do at one Agent (ADR 0010): each level holds the ones
/// below it, so Manage can also approve and use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum GrantLevel {
    Use,
    Approve,
    Manage,
}

impl GrantLevel {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "use" => Some(Self::Use),
            "approve" => Some(Self::Approve),
            "manage" => Some(Self::Manage),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Use => "use",
            Self::Approve => "approve",
            Self::Manage => "manage",
        }
    }
}

/// One Member's level at one Agent, as signed by an Owner or a Manager there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    pub agent: String,
    pub member: String,
    pub level: GrantLevel,
}

/// A group of Members with one set of Grants (ADR 0091). Only an Owner names it
/// and its admins; an admin changes who is in it; changing its Grants takes
/// Manage at each Agent changed. A copy only gives way to a higher `version`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub version: u64,
    pub members: Vec<String>,
    pub admins: Vec<String>,
    /// Agent and level, only Agents on this Machine.
    pub grants: Vec<(String, GrantLevel)>,
}

impl Group {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "members": self.members,
            "admins": self.admins,
            "grants": self
                .grants
                .iter()
                .map(|(agent, level)| json!({ "agent": agent, "level": level.as_str() }))
                .collect::<Vec<_>>(),
        })
    }

    /// A group as `group.set` or `trust.json` hold it; None when any part is unreadable.
    fn from_json(value: &Value) -> Option<Group> {
        let texts = |name: &str| -> Option<Vec<String>> {
            value
                .get(name)?
                .as_array()?
                .iter()
                .map(|v| v.as_str().map(str::to_string))
                .collect()
        };
        Some(Group {
            id: value.get("id")?.as_str()?.to_string(),
            name: value.get("name")?.as_str()?.to_string(),
            version: value.get("version")?.as_u64()?,
            members: texts("members")?,
            admins: texts("admins")?,
            grants: value
                .get("grants")?
                .as_array()?
                .iter()
                .map(|grant| {
                    Some((
                        grant.get("agent")?.as_str()?.to_string(),
                        GrantLevel::parse(grant.get("level")?.as_str()?)?,
                    ))
                })
                .collect::<Option<Vec<_>>>()?,
        })
    }

    fn level_at(&self, agent: &str) -> Option<GrantLevel> {
        self.grants
            .iter()
            .find(|(at, _)| at == agent)
            .map(|(_, level)| *level)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trust {
    pub owners: Vec<Owner>,
    /// Members who are not Owners, with their keys: they reach only the Agents
    /// their Grants name (ADR 0010, 0059). An Invitation adds them (#99).
    pub members: Vec<Owner>,
    pub grants: Vec<Grant>,
    pub groups: Vec<Group>,
    pub workspace: Option<String>,
    pub links: Vec<(String, String)>,
    pub revoked: Vec<String>,
}

impl Trust {
    /// Every key an envelope may be signed by: Owners' and Members'.
    pub fn trusted_keys(&self) -> std::collections::HashSet<String> {
        self.owners
            .iter()
            .chain(&self.members)
            .flat_map(|owner| owner.keys.iter().cloned())
            .collect()
    }

    /// Whether `key` is one of `member`'s among `people`, or, with no key
    /// named, whether `member` is there at all: a key trusted for one Member
    /// cannot act as another.
    fn holds(people: &[Owner], member: &str, key: Option<&str>) -> bool {
        people.iter().any(|person| {
            person.member == member
                && key.is_none_or(|key| person.keys.iter().any(|known| known == key))
        })
    }

    /// Whether this Member, signing with this key, is an Owner: the root of
    /// trust, with Manage at every Agent (ADR 0031).
    pub fn is_owner(&self, member: &str, key: Option<&str>) -> bool {
        Self::holds(&self.owners, member, key)
    }

    /// This Member's level at this Agent: Manage for an Owner, for a Member the
    /// highest of their own Grant and every group they are in (ADR 0091), none
    /// for a key that is not theirs.
    pub fn level(&self, agent: &str, member: &str, key: Option<&str>) -> Option<GrantLevel> {
        if self.is_owner(member, key) {
            return Some(GrantLevel::Manage);
        }
        if !Self::holds(&self.members, member, key) {
            return None;
        }
        let own = self
            .grants
            .iter()
            .find(|grant| grant.agent == agent && grant.member == member)
            .map(|grant| grant.level);
        self.groups
            .iter()
            .filter(|group| group.members.iter().any(|m| m == member))
            .map(|group| group.level_at(agent))
            .fold(own, Ord::max)
    }

    /// Whether this Member may change this Agent's settings and Grants (ADR 0010).
    pub fn manages(&self, agent: &str, member: &str, key: Option<&str>) -> bool {
        self.level(agent, member, key) >= Some(GrantLevel::Manage)
    }

    /// Whether this Member may answer this Agent's Approvals (ADR 0010).
    pub fn approves(&self, agent: &str, member: &str, key: Option<&str>) -> bool {
        self.level(agent, member, key) >= Some(GrantLevel::Approve)
    }

    /// Whether this Member may give this Agent work, a Trigger included
    /// (ADR 0010, issue #56).
    pub fn uses(&self, agent: &str, member: &str, key: Option<&str>) -> bool {
        self.level(agent, member, key) >= Some(GrantLevel::Use)
    }

    /// Sets `member`'s level at `agent`, or takes it away with `None`.
    pub fn set_grant(&mut self, agent: &str, member: &str, level: Option<GrantLevel>) {
        self.grants
            .retain(|grant| !(grant.agent == agent && grant.member == member));
        if let Some(level) = level {
            self.grants.push(Grant {
                agent: agent.to_string(),
                member: member.to_string(),
                level,
            });
        }
    }

    /// Trust after a signed `grant.set` (ADR 0010), or the error to answer:
    /// only an Owner or a Manager at that Agent grants there, only to a Member
    /// who is not an Owner (Owners hold Manage everywhere already).
    pub fn grant(
        &self,
        agent_exists: bool,
        member: &str,
        key: Option<&str>,
        body: &Value,
    ) -> Result<Trust, &'static str> {
        let text = |name: &str| body.get(name).and_then(Value::as_str).unwrap_or_default();
        let (agent, to) = (text("agent"), text("member"));
        if !agent_exists {
            return Err("agent.unknown");
        }
        if !self.manages(agent, member, key) {
            return Err("grant.forbidden");
        }
        if self.owners.iter().any(|owner| owner.member == to) {
            return Err("grant.owner");
        }
        if !self.members.iter().any(|person| person.member == to) {
            return Err("grant.unknown_member");
        }
        let level = match text("level") {
            "none" => None,
            level => Some(GrantLevel::parse(level).ok_or("grant.invalid")?),
        };
        let mut next = self.clone();
        next.set_grant(agent, to, level);
        Ok(next)
    }

    /// Trust after a signed `group.set` (ADR 0091), or the error to answer.
    /// `agent_exists` says whether an Agent is on this Machine and not trashed.
    pub fn set_group(
        &self,
        agent_exists: &dyn Fn(&str) -> bool,
        member: &str,
        key: Option<&str>,
        body: &Value,
    ) -> Result<Trust, &'static str> {
        let next = Group::from_json(body).ok_or("group.invalid")?;
        let stored = self.groups.iter().find(|group| group.id == next.id);
        if stored.is_some_and(|stored| next.version <= stored.version) {
            return Err("group.stale");
        }
        for person in next.members.iter().chain(&next.admins) {
            if self.owners.iter().any(|owner| &owner.member == person) {
                return Err("grant.owner");
            }
            if !self.members.iter().any(|known| &known.member == person) {
                return Err("grant.unknown_member");
            }
        }
        if next.grants.iter().any(|(agent, _)| !agent_exists(agent)) {
            return Err("agent.unknown");
        }
        let owner = self.is_owner(member, key);
        let Some(stored) = stored else {
            return if owner {
                Ok(self.with_group(next))
            } else {
                Err("group.forbidden")
            };
        };
        if (next.name != stored.name || next.admins != stored.admins) && !owner {
            return Err("group.forbidden");
        }
        let admin =
            Self::holds(&self.members, member, key) && stored.admins.iter().any(|a| a == member);
        let mut before = stored.members.clone();
        let mut after = next.members.clone();
        before.sort();
        after.sort();
        if before != after && !owner && !admin {
            return Err("group.forbidden");
        }
        let changed = stored
            .grants
            .iter()
            .chain(&next.grants)
            .map(|(agent, _)| agent)
            .filter(|agent| stored.level_at(agent) != next.level_at(agent));
        for agent in changed {
            if !self.manages(agent, member, key) {
                return Err("grant.forbidden");
            }
        }
        Ok(self.with_group(next))
    }

    fn with_group(&self, group: Group) -> Trust {
        let mut next = self.clone();
        next.groups.retain(|kept| kept.id != group.id);
        next.groups.push(group);
        next
    }

    /// The body of `groups.listed`: every group for an Owner, else the ones
    /// this Member is in or looks after.
    pub fn groups_listed(&self, member: &str, key: Option<&str>) -> Value {
        let owner = self.is_owner(member, key);
        json!({
            "groups": self
                .groups
                .iter()
                .filter(|group| owner || group.members.iter().chain(&group.admins).any(|m| m == member))
                .map(Group::to_json)
                .collect::<Vec<_>>(),
        })
    }

    /// The body of `grants.listed` for one Agent.
    pub fn grants_listed(&self, agent: &str) -> Value {
        json!({
            "agent": agent,
            "grants": self
                .grants
                .iter()
                .filter(|grant| grant.agent == agent)
                .map(|grant| json!({ "member": grant.member, "level": grant.level.as_str() }))
                .collect::<Vec<_>>(),
        })
    }

    /// The keys revoked here that `before` still had, so what they registered
    /// (a push token) goes with them (ADR 0044).
    pub fn revoked_since(&self, before: &Trust) -> Vec<String> {
        self.revoked
            .iter()
            .filter(|key| !before.revoked.contains(key))
            .cloned()
            .collect()
    }

    fn to_json(&self) -> Value {
        let people = |people: &[Owner]| {
            people
                .iter()
                .map(|owner| json!({ "member": owner.member, "keys": owner.keys }))
                .collect::<Vec<_>>()
        };
        let mut value = json!({
            "owners": people(&self.owners),
            "links": self
                .links
                .iter()
                .map(|(key, by)| json!({ "key": key, "by": by }))
                .collect::<Vec<_>>(),
            "revoked": self.revoked,
        });
        if let Some(workspace) = &self.workspace {
            value["workspace"] = json!(workspace);
        }
        // Only a Machine with Members other than Owners writes them, so a
        // one-person Machine's file stays as it was.
        if !self.members.is_empty() {
            value["members"] = json!(people(&self.members));
        }
        if !self.grants.is_empty() {
            value["grants"] = self
                .grants
                .iter()
                .map(|grant| json!({ "agent": grant.agent, "member": grant.member, "level": grant.level.as_str() }))
                .collect();
        }
        if !self.groups.is_empty() {
            value["groups"] = self.groups.iter().map(Group::to_json).collect();
        }
        value
    }
}

/// A broken file stops the Runtime instead of reading as "nobody is trusted",
/// which `pair` would then overwrite.
pub fn load_trust(home: &Path) -> Result<Trust, TrustError> {
    let file = supervisor_dir(home)?.join("trust.json");
    let Some(value) = read_json_file(&file)? else {
        return Ok(Trust::default());
    };
    let people = |name: &str| {
        value
            .get(name)
            .and_then(Value::as_array)
            .and_then(|owners| {
                owners
                    .iter()
                    .map(|owner| {
                        Some(Owner {
                            member: owner.get("member")?.as_str()?.to_string(),
                            keys: owner
                                .get("keys")?
                                .as_array()?
                                .iter()
                                .map(|key| key.as_str().map(str::to_string))
                                .collect::<Option<Vec<_>>>()?,
                        })
                    })
                    .collect::<Option<Vec<_>>>()
            })
            .ok_or_else(|| {
                TrustError::File(format!(
                    "cannot read {}: {name} is not a list of people",
                    file.display()
                ))
            })
    };
    let owners = people("owners")?;
    // A file from before Members other than Owners has none.
    let members = if value.get("members").is_some() {
        people("members")?
    } else {
        Vec::new()
    };
    // A Grant this Runtime cannot read is dropped, never widened.
    let grants = value
        .get("grants")
        .and_then(Value::as_array)
        .map(|grants| {
            grants
                .iter()
                .filter_map(|grant| {
                    Some(Grant {
                        agent: grant.get("agent")?.as_str()?.to_string(),
                        member: grant.get("member")?.as_str()?.to_string(),
                        level: GrantLevel::parse(grant.get("level")?.as_str()?)?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    // Like a Grant, a group this Runtime cannot read is dropped.
    let groups = value
        .get("groups")
        .and_then(Value::as_array)
        .map(|groups| groups.iter().filter_map(Group::from_json).collect())
        .unwrap_or_default();
    Ok(Trust {
        owners,
        members,
        grants,
        groups,
        workspace: value
            .get("workspace")
            .and_then(Value::as_str)
            .map(str::to_string),
        links: value
            .get("links")
            .and_then(Value::as_array)
            .map(|links| {
                links
                    .iter()
                    .filter_map(|link| {
                        Some((
                            link.get("key")?.as_str()?.to_string(),
                            link.get("by")?.as_str()?.to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        revoked: value
            .get("revoked")
            .and_then(Value::as_array)
            .map(|keys| {
                keys.iter()
                    .filter_map(|key| key.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

pub fn save_trust(home: &Path, trust: &Trust) -> Result<(), TrustError> {
    write_json_file(&supervisor_dir(home)?.join("trust.json"), &trust.to_json())?;
    Ok(())
}

/// Trust after the certificates the Hub handed over (ADR 0031). Each is only
/// believed for a signature by a key this Machine already trusts for the same
/// Member, so a Hub can neither add a key nor take one away. Applying the same
/// list again changes nothing.
///
/// Ported from `packages/runtime-legacy/src/supervisor/trust/certificates.ts`.
pub fn apply_certificates(trust: &Trust, certificates: &[Value], log: &dyn Fn(&str)) -> Trust {
    use veeloe_protocol::certificate::{revoked_with, verify_certificate};

    let mut next = Trust {
        owners: trust
            .owners
            .iter()
            .map(|owner| Owner {
                member: owner.member.clone(),
                keys: owner.keys.clone(),
            })
            .collect(),
        members: trust.members.clone(),
        grants: trust.grants.clone(),
        groups: trust.groups.clone(),
        workspace: trust.workspace.clone(),
        links: trust.links.clone(),
        revoked: trust.revoked.clone(),
    };
    for certificate in certificates {
        let Some(body) = verify_certificate(certificate) else {
            log("ignored a certificate: bad-signature");
            continue;
        };
        let Some(workspace) = body.get("workspace").and_then(Value::as_str) else {
            continue;
        };
        if next
            .workspace
            .as_deref()
            .is_some_and(|own| own != workspace)
        {
            log("ignored a certificate: other-workspace");
            continue;
        }
        // A new Member through an Invitation (ADR 0059): believed from an Owner's
        // key, or from a Member who manages an Agent here. Their Grants come
        // after, each signed on its own (`grant.set`).
        if body.get("type").and_then(Value::as_str) == Some("member.add") {
            add_member(&mut next, &body, log);
            continue;
        }
        if body.get("type").and_then(Value::as_str) == Some("member.remove") {
            remove_member(&mut next, &body, log);
            continue;
        }
        let (Some(member), Some(key), Some(by), Some(type_)) = (
            body.get("member").and_then(Value::as_str),
            body.get("key").and_then(Value::as_str),
            body.get("by").and_then(Value::as_str),
            body.get("type").and_then(Value::as_str),
        ) else {
            continue;
        };
        // A Member links and revokes their own devices as an Owner does.
        let Some(owner) = next
            .owners
            .iter_mut()
            .chain(next.members.iter_mut())
            .find(|owner| owner.member == member)
        else {
            if !next.revoked.iter().any(|revoked| revoked == key) {
                log("ignored a certificate: untrusted-signer");
            }
            continue;
        };
        if !owner.keys.iter().any(|trusted| trusted == by) {
            if !next.revoked.iter().any(|revoked| revoked == key) {
                log("ignored a certificate: untrusted-signer");
            }
            continue;
        }
        if type_ == "device.link" {
            if next.revoked.iter().any(|revoked| revoked == key) {
                continue;
            }
            if !owner.keys.iter().any(|trusted| trusted == key) {
                owner.keys.push(key.to_string());
            }
            if !next.links.iter().any(|(linked, _)| linked == key) {
                next.links.push((key.to_string(), by.to_string()));
            }
            continue;
        }
        let keep: Vec<String> = body
            .get("keep")
            .and_then(Value::as_array)
            .map(|keys| {
                keys.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let drops = revoked_with(key, &next.links, &keep);
        let left: Vec<String> = owner
            .keys
            .iter()
            .filter(|trusted| !drops.iter().any(|drop| drop == *trusted))
            .cloned()
            .collect();
        if left.is_empty() {
            // Nobody could sign for this Member again; `veeloe unpair` is the
            // way out (ADR 0035).
            log("ignored a revocation that would leave this Member no key");
            continue;
        }
        owner.keys = left;
        for key in drops {
            if !next.revoked.iter().any(|revoked| revoked == &key) {
                next.revoked.push(key);
            }
        }
    }
    next
}

fn add_member(next: &mut Trust, body: &Value, log: &dyn Fn(&str)) {
    let text = |name: &str| body.get(name).and_then(Value::as_str).unwrap_or_default();
    let (member, key, by) = (text("member"), text("key"), text("by"));
    let owner_key = next
        .owners
        .iter()
        .any(|owner| owner.keys.iter().any(|known| known == by));
    // A group admin brings people into their group (ADR 0091); Manage at an Agent no longer does (ADR 0093).
    let admin_key = next.members.iter().any(|person| {
        person.keys.iter().any(|known| known == by)
            && next
                .groups
                .iter()
                .any(|group| group.admins.contains(&person.member))
    });
    if !owner_key && !admin_key {
        log("ignored a certificate: untrusted-signer");
        return;
    }
    let known_key = next
        .owners
        .iter()
        .chain(&next.members)
        .any(|person| person.keys.iter().any(|known| known == key));
    let known_member = next
        .owners
        .iter()
        .chain(&next.members)
        .any(|person| person.member == member);
    // The same certificate again changes nothing; a key or Member id already
    // here, or a revoked key, is never taken over.
    if known_key || known_member || next.revoked.iter().any(|revoked| revoked == key) {
        return;
    }
    next.members.push(Owner {
        member: member.to_string(),
        keys: vec![key.to_string()],
    });
}

/// A Member taken out on an Owner's signature (ADR 0059): their keys are revoked,
/// so what they set up stops, and their Grants go. An Owner is never taken out
/// this way.
fn remove_member(next: &mut Trust, body: &Value, log: &dyn Fn(&str)) {
    let text = |name: &str| body.get(name).and_then(Value::as_str).unwrap_or_default();
    let (member, by) = (text("member"), text("by"));
    if !next
        .owners
        .iter()
        .any(|owner| owner.keys.iter().any(|known| known == by))
    {
        log("ignored a certificate: untrusted-signer");
        return;
    }
    let Some(index) = next
        .members
        .iter()
        .position(|person| person.member == member)
    else {
        return;
    };
    let gone = next.members.remove(index);
    for key in gone.keys {
        if !next.revoked.contains(&key) {
            next.revoked.push(key);
        }
    }
    next.grants.retain(|grant| grant.member != member);
    for group in &mut next.groups {
        group.members.retain(|m| m != member);
        group.admins.retain(|m| m != member);
    }
}

/// The numbers a connection takes in memory, with a window so an envelope that
/// came late by the other path is still taken once (ADR 0090).
#[derive(Debug, Default)]
pub struct WindowSeenSequences {
    last: HashMap<String, u64>,
    window: veeloe_protocol::envelope::Window,
}

impl SeenSequences for WindowSeenSequences {
    fn last(&self, sender: &str) -> Option<u64> {
        self.last.get(sender).copied()
    }

    fn record(&mut self, sender: &str, seq: u64) {
        let last = self.last(sender);
        self.window.record(sender, seq, last);
        if last.is_none_or(|last| seq > last) {
            self.last.insert(sender.to_string(), seq);
        }
    }

    fn is_new(&self, sender: &str, seq: u64) -> bool {
        self.window.is_new(sender, seq, self.last(sender))
    }
}

/// The last sequence number per key, in `seen.json`. It also holds this
/// Machine's own key: the last number it sent.
pub struct FileSeenSequences {
    file: PathBuf,
    last: HashMap<String, u64>,
    /// What this run accepted, so a number that came late by the other path
    /// is still taken once (ADR 0090). Not kept: a restart refuses all of it.
    window: veeloe_protocol::envelope::Window,
}

impl FileSeenSequences {
    pub fn open(home: &Path) -> Result<Self, TrustError> {
        let file = supervisor_dir(home)?.join("seen.json");
        let mut last = HashMap::new();
        if let Some(value) = read_json_file(&file)? {
            if let Some(object) = value.as_object() {
                for (key, seq) in object {
                    if let Some(seq) = seq.as_u64() {
                        last.insert(key.clone(), seq);
                    }
                }
            }
        }
        Ok(Self {
            file,
            last,
            window: Default::default(),
        })
    }

    /// The next number for this Machine to sign with.
    pub fn next(&mut self, own_key: &str) -> u64 {
        let seq = self.last(own_key).unwrap_or(0) + 1;
        self.record(own_key, seq);
        seq
    }

    fn save(&self) -> Result<(), TrustError> {
        let value = Value::Object(
            self.last
                .iter()
                .map(|(key, seq)| (key.clone(), json!(seq)))
                .collect(),
        );
        write_json_file(&self.file, &value)?;
        Ok(())
    }
}

impl SeenSequences for FileSeenSequences {
    fn last(&self, sender: &str) -> Option<u64> {
        self.last.get(sender).copied()
    }

    fn record(&mut self, sender: &str, seq: u64) {
        let last = self.last(sender);
        self.window.record(sender, seq, last);
        // Only ever up: a number taken late must not lower what is kept.
        if last.is_some_and(|last| seq <= last) {
            return;
        }
        self.last.insert(sender.to_string(), seq);
        // A tally that cannot be written is reported by the caller that needs it.
        let _ = self.save();
    }

    fn is_new(&self, sender: &str, seq: u64) -> bool {
        self.window.is_new(sender, seq, self.last(sender))
    }
}

fn from_hex(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(text.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// Fills a buffer from the operating system's random source.
fn getrandom(buffer: &mut [u8]) {
    let filled = unsafe {
        libc::getentropy(
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len() as libc::size_t,
        )
    };
    assert_eq!(filled, 0, "the operating system has no entropy");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};
    use veeloe_protocol::certificate::sign_certificate;
    use veeloe_protocol::crypto::public_key_base64url;

    fn key(seed: u8) -> String {
        public_key_base64url(&[seed; 32])
    }

    fn paired() -> Trust {
        Trust {
            owners: vec![Owner {
                member: "m_1".into(),
                keys: vec![key(0x41)],
            }],
            workspace: Some("w_1".into()),
            ..Trust::default()
        }
    }

    fn certificate(fields: &[(&str, Value)], by: u8) -> Value {
        let mut body = Map::new();
        for (name, value) in fields {
            body.insert(name.to_string(), value.clone());
        }
        sign_certificate(&body, &[by; 32])
    }

    fn link(by: u8, to: u8) -> Value {
        certificate(
            &[
                ("type", json!("device.link")),
                ("workspace", json!("w_1")),
                ("member", json!("m_1")),
                ("key", json!(key(to))),
                ("name", json!("device")),
                ("at", json!(1)),
            ],
            by,
        )
    }

    fn revoke(by: u8, what: u8, keep: &[u8]) -> Value {
        certificate(
            &[
                ("type", json!("device.revoke")),
                ("workspace", json!("w_1")),
                ("member", json!("m_1")),
                ("key", json!(key(what))),
                (
                    "keep",
                    json!(keep.iter().map(|seed| key(*seed)).collect::<Vec<_>>()),
                ),
                ("at", json!(2)),
            ],
            by,
        )
    }

    fn quiet(_: &str) {}

    #[test]
    fn a_link_signed_by_a_trusted_key_adds_it_once() {
        let once = apply_certificates(&paired(), &[link(0x41, 0x42)], &quiet);
        assert_eq!(once.owners[0].keys, vec![key(0x41), key(0x42)]);
        assert_eq!(once.links, vec![(key(0x42), key(0x41))]);
        assert_eq!(apply_certificates(&once, &[link(0x41, 0x42)], &quiet), once);
    }

    #[test]
    fn a_link_from_an_untrusted_signer_or_another_workspace_adds_nothing() {
        let stranger = apply_certificates(&paired(), &[link(0x44, 0x42)], &quiet);
        assert_eq!(stranger, paired());
        let other = certificate(
            &[
                ("type", json!("device.link")),
                ("workspace", json!("w_2")),
                ("member", json!("m_1")),
                ("key", json!(key(0x42))),
                ("name", json!("device")),
                ("at", json!(1)),
            ],
            0x41,
        );
        assert_eq!(apply_certificates(&paired(), &[other], &quiet), paired());
    }

    #[test]
    fn revoking_a_key_drops_what_it_linked_and_keeps_what_was_kept() {
        let linked = apply_certificates(
            &paired(),
            &[link(0x41, 0x42), link(0x42, 0x43), link(0x42, 0x44)],
            &quiet,
        );
        let after = apply_certificates(&linked, &[revoke(0x41, 0x42, &[0x43])], &quiet);
        assert_eq!(after.owners[0].keys, vec![key(0x41), key(0x43)]);
        assert_eq!(after.revoked, vec![key(0x42), key(0x44)]);
    }

    #[test]
    fn only_a_key_revoked_by_this_change_is_new() {
        let linked = apply_certificates(&paired(), &[link(0x41, 0x42), link(0x41, 0x43)], &|_| {});
        let once = apply_certificates(&linked, &[revoke(0x41, 0x42, &[])], &|_| {});
        assert_eq!(once.revoked_since(&linked), vec![key(0x42)]);
        let twice = apply_certificates(&once, &[revoke(0x41, 0x43, &[])], &|_| {});
        assert_eq!(twice.revoked_since(&once), vec![key(0x43)]);
    }

    #[test]
    fn a_revoked_key_never_comes_back_from_an_old_link() {
        let revoked = apply_certificates(
            &paired(),
            &[link(0x41, 0x42), link(0x42, 0x43), revoke(0x41, 0x42, &[])],
            &quiet,
        );
        assert_eq!(revoked.owners[0].keys, vec![key(0x41)]);
        let replayed = apply_certificates(
            &revoked,
            &[link(0x41, 0x42), link(0x42, 0x44), link(0x41, 0x43)],
            &quiet,
        );
        assert_eq!(replayed.owners[0].keys, vec![key(0x41)]);
    }

    #[test]
    fn a_revocation_that_would_leave_no_key_is_not_followed() {
        let alone = apply_certificates(&paired(), &[revoke(0x41, 0x41, &[])], &quiet);
        assert_eq!(alone, paired());
        let two = apply_certificates(&paired(), &[link(0x41, 0x42)], &quiet);
        let after = apply_certificates(&two, &[revoke(0x42, 0x41, &[])], &quiet);
        assert_eq!(after.owners[0].keys, vec![key(0x41), key(0x42)]);
    }

    fn with_member() -> Trust {
        let mut trust = paired();
        trust.members.push(Owner {
            member: "m_2".into(),
            keys: vec![key(0x51)],
        });
        trust
    }

    #[test]
    fn an_owner_has_every_level_at_every_agent() {
        let trust = paired();
        assert!(trust.manages("a_1", "m_1", Some(&key(0x41))));
        // Not with another Member's key, nor a stranger's.
        assert!(!trust.uses("a_1", "m_1", Some(&key(0x51))));
        assert!(!trust.uses("a_1", "m_9", None));
    }

    #[test]
    fn a_member_has_only_the_level_granted_at_that_agent() {
        let mut trust = with_member();
        assert!(!trust.uses("a_1", "m_2", Some(&key(0x51))));
        trust.set_grant("a_1", "m_2", Some(GrantLevel::Approve));
        assert!(trust.uses("a_1", "m_2", Some(&key(0x51))));
        assert!(trust.approves("a_1", "m_2", Some(&key(0x51))));
        assert!(!trust.manages("a_1", "m_2", Some(&key(0x51))));
        assert!(!trust.uses("a_2", "m_2", Some(&key(0x51))));
        assert!(!trust.is_owner("m_2", Some(&key(0x51))));
        // The Owner's key does not carry the Member's Grant, nor the other way.
        assert!(!trust.uses("a_1", "m_2", Some(&key(0x41))));
        trust.set_grant("a_1", "m_2", None);
        assert!(!trust.uses("a_1", "m_2", Some(&key(0x51))));
        assert!(trust.trusted_keys().contains(&key(0x51)));
    }

    #[test]
    fn a_member_gets_the_highest_level_of_their_groups_and_loses_it_when_taken_out() {
        let mut trust = with_member();
        trust.members.push(Owner {
            member: "m_3".into(),
            keys: vec![key(0x61)],
        });
        let (owner, kai, lee) = (Some(key(0x41)), Some(key(0x51)), Some(key(0x61)));
        let any = |_: &str| true;
        let group = |id: &str, version: u64, members: &[&str], admins: &[&str], level: &str| {
            json!({ "id": id, "name": id, "version": version, "members": members, "admins": admins,
                    "grants": [{ "agent": "a_1", "level": level }] })
        };
        // Only an Owner makes a group; in two, Kai holds the higher level.
        assert_eq!(
            trust.set_group(
                &any,
                "m_2",
                kai.as_deref(),
                &group("g_a", 1, &["m_2"], &[], "use")
            ),
            Err("group.forbidden")
        );
        let two = trust
            .set_group(
                &any,
                "m_1",
                owner.as_deref(),
                &group("g_a", 1, &["m_2"], &["m_3"], "use"),
            )
            .and_then(|t| {
                t.set_group(
                    &any,
                    "m_1",
                    owner.as_deref(),
                    &group("g_b", 1, &["m_2"], &[], "approve"),
                )
            })
            .expect("owner makes both");
        assert_eq!(
            two.level("a_1", "m_2", kai.as_deref()),
            Some(GrantLevel::Approve)
        );
        assert_eq!(two.level("a_1", "m_2", lee.as_deref()), None);
        // An older copy never comes back.
        assert_eq!(
            two.set_group(
                &any,
                "m_1",
                owner.as_deref(),
                &group("g_b", 1, &[], &[], "approve")
            ),
            Err("group.stale")
        );
        // The admin changes who is in it, not what it grants; Kai out of g_b falls back to Use.
        assert_eq!(
            two.set_group(
                &any,
                "m_3",
                lee.as_deref(),
                &group("g_a", 2, &["m_2"], &["m_3"], "manage")
            ),
            Err("grant.forbidden")
        );
        let moved = two
            .set_group(
                &any,
                "m_3",
                lee.as_deref(),
                &group("g_a", 2, &["m_2", "m_3"], &["m_3"], "use"),
            )
            .expect("admin adds Lee");
        assert!(moved.uses("a_1", "m_3", lee.as_deref()));
        let out = moved
            .set_group(
                &any,
                "m_1",
                owner.as_deref(),
                &group("g_b", 2, &[], &[], "approve"),
            )
            .expect("owner takes Kai out");
        assert_eq!(
            out.level("a_1", "m_2", kai.as_deref()),
            Some(GrantLevel::Use)
        );
        // Only an Owner names admins; a group's Grant is only at an Agent here.
        assert_eq!(
            moved.set_group(
                &any,
                "m_3",
                lee.as_deref(),
                &group("g_a", 3, &["m_2", "m_3"], &["m_2", "m_3"], "use")
            ),
            Err("group.forbidden")
        );
        assert_eq!(
            trust.set_group(
                &|_| false,
                "m_1",
                owner.as_deref(),
                &group("g_c", 1, &[], &[], "use")
            ),
            Err("agent.unknown")
        );
        assert_eq!(
            out.groups_listed("m_2", kai.as_deref())["groups"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn only_an_owner_or_a_manager_there_grants_and_only_to_a_member() {
        let mut trust = with_member();
        trust.members.push(Owner {
            member: "m_3".into(),
            keys: vec![key(0x61)],
        });
        let body =
            |member: &str, level: &str| json!({ "agent": "a_1", "member": member, "level": level });
        let owner = Some(key(0x41));
        let granted = trust
            .grant(true, "m_1", owner.as_deref(), &body("m_2", "manage"))
            .expect("owner grants");
        assert!(granted.manages("a_1", "m_2", Some(&key(0x51))));
        // A Manager there grants others; a Member with only Use does not.
        let by_manager = granted
            .grant(true, "m_2", Some(&key(0x51)), &body("m_3", "use"))
            .expect("manager grants");
        assert!(by_manager.uses("a_1", "m_3", Some(&key(0x61))));
        assert_eq!(
            by_manager.grant(true, "m_3", Some(&key(0x61)), &body("m_3", "manage")),
            Err("grant.forbidden")
        );
        // Not at another Agent, not to an Owner, not to a stranger, not an unknown Agent.
        let other = json!({ "agent": "a_2", "member": "m_3", "level": "use" });
        assert_eq!(
            granted.grant(true, "m_2", Some(&key(0x51)), &other),
            Err("grant.forbidden")
        );
        assert_eq!(
            trust.grant(true, "m_1", owner.as_deref(), &body("m_1", "use")),
            Err("grant.owner")
        );
        assert_eq!(
            trust.grant(true, "m_1", owner.as_deref(), &body("m_9", "use")),
            Err("grant.unknown_member")
        );
        assert_eq!(
            trust.grant(false, "m_1", owner.as_deref(), &body("m_2", "use")),
            Err("agent.unknown")
        );
        // `none` takes it away.
        let taken = by_manager
            .grant(true, "m_1", owner.as_deref(), &body("m_3", "none"))
            .expect("taken");
        assert!(!taken.uses("a_1", "m_3", Some(&key(0x61))));
        assert_eq!(
            taken.grants_listed("a_1"),
            json!({ "agent": "a_1", "grants": [{ "member": "m_2", "level": "manage" }] })
        );
    }

    fn added(by: u8, member: &str, key_seed: u8) -> Value {
        certificate(
            &[
                ("type", json!("member.add")),
                ("workspace", json!("w_1")),
                ("member", json!(member)),
                ("key", json!(key(key_seed))),
                ("name", json!("Kai")),
                ("invitation", json!("AAAAAAAAAAAAAAAAAAAAAA")),
                ("at", json!(1)),
            ],
            by,
        )
    }

    #[test]
    fn a_member_is_added_only_by_an_owner_or_a_group_admin_and_never_over_someone() {
        let after = apply_certificates(&paired(), &[added(0x41, "m_kai", 0x71)], &quiet);
        assert_eq!(
            after.members,
            vec![Owner {
                member: "m_kai".into(),
                keys: vec![key(0x71)]
            }]
        );
        // Again: nothing more.
        assert_eq!(
            apply_certificates(&after, &[added(0x41, "m_kai", 0x71)], &quiet),
            after
        );
        // Not from a stranger, nor a Member who manages nothing.
        assert_eq!(
            apply_certificates(&paired(), &[added(0x44, "m_x", 0x72)], &quiet),
            paired()
        );
        assert_eq!(
            apply_certificates(&after, &[added(0x71, "m_x", 0x72)], &quiet),
            after
        );
        // Manage at an Agent does not bring people in (ADR 0093); a group admin does.
        let mut managing = after.clone();
        managing.set_grant("a_1", "m_kai", Some(GrantLevel::Manage));
        assert_eq!(
            apply_certificates(&managing, &[added(0x71, "m_lee", 0x72)], &quiet),
            managing
        );
        let mut admin = after.clone();
        admin.groups.push(Group {
            id: "g_sales".into(),
            name: "Sales".into(),
            version: 1,
            members: vec![],
            admins: vec!["m_kai".into()],
            grants: vec![],
        });
        let by_admin = apply_certificates(&admin, &[added(0x71, "m_lee", 0x72)], &quiet);
        assert_eq!(by_admin.members.len(), 2);
        // Never an Owner's id, nor a key someone holds.
        assert_eq!(
            apply_certificates(&paired(), &[added(0x41, "m_1", 0x73)], &quiet),
            paired()
        );
        assert_eq!(
            apply_certificates(&after, &[added(0x41, "m_new", 0x71)], &quiet),
            after
        );
    }

    #[test]
    fn an_owner_removes_a_member_and_their_keys_and_grants_go() {
        let mut trust = apply_certificates(&paired(), &[added(0x41, "m_kai", 0x71)], &quiet);
        trust.set_grant("a_1", "m_kai", Some(GrantLevel::Manage));
        let removed = |by: u8| {
            certificate(
                &[
                    ("type", json!("member.remove")),
                    ("workspace", json!("w_1")),
                    ("member", json!("m_kai")),
                    ("key", json!(key(by))),
                    ("at", json!(2)),
                ],
                by,
            )
        };
        // Not by the Member themselves, even with Manage.
        assert_eq!(apply_certificates(&trust, &[removed(0x71)], &quiet), trust);
        let after = apply_certificates(&trust, &[removed(0x41)], &quiet);
        assert!(after.members.is_empty() && after.grants.is_empty());
        assert_eq!(after.revoked, vec![key(0x71)]);
        assert!(!after.trusted_keys().contains(&key(0x71)));
    }

    #[test]
    fn members_and_grants_survive_the_file_and_an_unknown_level_is_dropped() {
        let home = tempfile::tempdir().expect("home");
        let mut trust = with_member();
        trust.set_grant("a_1", "m_2", Some(GrantLevel::Use));
        save_trust(home.path(), &trust).expect("save");
        assert_eq!(load_trust(home.path()).expect("load"), trust);
        let file = home.path().join("runtime/trust.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        value["grants"][0]["level"] = json!("owner");
        fs::write(&file, value.to_string()).unwrap();
        assert!(load_trust(home.path()).expect("load").grants.is_empty());
    }
}
