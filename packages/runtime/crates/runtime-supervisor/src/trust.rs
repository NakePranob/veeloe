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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trust {
    pub owners: Vec<Owner>,
    /// Members who are not Owners, with their keys: they reach only the Agents
    /// their Grants name (ADR 0010, 0059). An Invitation adds them (#99).
    pub members: Vec<Owner>,
    pub grants: Vec<Grant>,
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

    /// This Member's level at this Agent: Manage for an Owner, the Grant for a
    /// Member, none for a key that is not theirs.
    pub fn level(&self, agent: &str, member: &str, key: Option<&str>) -> Option<GrantLevel> {
        if self.is_owner(member, key) {
            return Some(GrantLevel::Manage);
        }
        if !Self::holds(&self.members, member, key) {
            return None;
        }
        self.grants
            .iter()
            .find(|grant| grant.agent == agent && grant.member == member)
            .map(|grant| grant.level)
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
            "members": people(&self.members),
            "grants": self
                .grants
                .iter()
                .map(|grant| json!({ "agent": grant.agent, "member": grant.member, "level": grant.level.as_str() }))
                .collect::<Vec<_>>(),
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
    Ok(Trust {
        owners,
        members,
        grants,
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
