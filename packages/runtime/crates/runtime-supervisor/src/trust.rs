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
            let end = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trust {
    pub owners: Vec<Owner>,
    pub workspace: Option<String>,
    pub links: Vec<(String, String)>,
    pub revoked: Vec<String>,
}

impl Trust {
    pub fn trusted_keys(&self) -> std::collections::HashSet<String> {
        self.owners
            .iter()
            .flat_map(|owner| owner.keys.iter().cloned())
            .collect()
    }

    fn to_json(&self) -> Value {
        let mut value = json!({
            "owners": self
                .owners
                .iter()
                .map(|owner| json!({ "member": owner.member, "keys": owner.keys }))
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
    let owners = value
        .get("owners")
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
                "cannot read {}: it is not a list of owners",
                file.display()
            ))
        })?;
    Ok(Trust {
        owners,
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
pub fn apply_certificates(
    trust: &Trust,
    certificates: &[Value],
    log: &dyn Fn(&str),
) -> Trust {
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
        if next.workspace.as_deref().is_some_and(|own| own != workspace) {
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
        let Some(owner) = next.owners.iter_mut().find(|owner| owner.member == member) else {
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

/// The last sequence number per key, in `seen.json`. It also holds this
/// Machine's own key: the last number it sent.
pub struct FileSeenSequences {
    file: PathBuf,
    last: HashMap<String, u64>,
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
        Ok(Self { file, last })
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
        self.last.insert(sender.to_string(), seq);
        // A tally that cannot be written is reported by the caller that needs it.
        let _ = self.save();
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
            links: Vec::new(),
            revoked: Vec::new(),
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
        assert_eq!(
            apply_certificates(&once, &[link(0x41, 0x42)], &quiet),
            once
        );
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
        assert_eq!(
            apply_certificates(&paired(), &[other], &quiet),
            paired()
        );
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
}
