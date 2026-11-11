//! Expo push tokens this Machine may send to (ADR 0044).
//!
//! A token belongs to one Controller key and the Member who signed with it.
//! The file holds no Task text, only what a notification needs to be addressed
//! and written in the Member's language.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

/// One Controller's Expo Push Token, kept for the Machine that serves it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushToken {
    pub member: String,
    /// The base64url key of the Controller that registered it.
    pub device: String,
    pub token: String,
    /// `th` or `en`; the language the Controller asked for at registration.
    #[serde(default = "default_language")]
    pub language: String,
    /// Unix milliseconds on this Machine.
    pub updated: u64,
}

fn default_language() -> String {
    "en".into()
}

#[derive(Debug, thiserror::Error)]
pub enum PushTokenError {
    #[error("{0}")]
    File(String),
    #[error("{0}")]
    Invalid(String),
}

impl From<JsonFileError> for PushTokenError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for PushTokenError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// The token book: loaded once, changed under a lock, written after every change.
pub struct PushTokens {
    file: PathBuf,
    tokens: Mutex<Vec<PushToken>>,
}

impl PushTokens {
    pub fn open(home: &Path) -> Result<Self, PushTokenError> {
        let file = supervisor_dir(home)?.join("push-tokens.json");
        let Some(value) = read_json_file(&file)? else {
            return Ok(Self {
                file,
                tokens: Mutex::new(Vec::new()),
            });
        };
        let tokens = value
            .as_array()
            .map(|records| {
                records
                    .iter()
                    .filter_map(|record| serde_json::from_value(record.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            file,
            tokens: Mutex::new(tokens),
        })
    }

    /// Keep this Controller's token, replacing an older one for the same key.
    pub fn register(
        &self,
        member: &str,
        device: &str,
        token: &str,
        language: &str,
        now_ms: u64,
    ) -> Result<PushToken, PushTokenError> {
        if member.is_empty() || device.is_empty() {
            return Err(PushTokenError::Invalid("member or device is empty".into()));
        }
        if !is_expo_token(token) {
            return Err(PushTokenError::Invalid("not an Expo push token".into()));
        }
        let language = if language == "th" { "th" } else { "en" };
        let record = PushToken {
            member: member.to_string(),
            device: device.to_string(),
            token: token.to_string(),
            language: language.to_string(),
            updated: now_ms,
        };
        let mut tokens = self.tokens.lock().expect("push tokens");
        tokens.retain(|held| held.device != device);
        tokens.push(record.clone());
        drop(tokens);
        self.save()?;
        Ok(record)
    }

    /// Forget this Controller's token; a different device is untouched.
    pub fn unregister(&self, device: &str) -> Result<bool, PushTokenError> {
        let mut tokens = self.tokens.lock().expect("push tokens");
        let before = tokens.len();
        tokens.retain(|held| held.device != device);
        let removed = tokens.len() != before;
        drop(tokens);
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    /// Drop every Controller key a revocation took away.
    pub fn remove_devices(&self, devices: &[String]) -> Result<(), PushTokenError> {
        if devices.is_empty() {
            return Ok(());
        }
        let mut tokens = self.tokens.lock().expect("push tokens");
        let before = tokens.len();
        tokens.retain(|held| !devices.iter().any(|device| device == &held.device));
        let changed = tokens.len() != before;
        drop(tokens);
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// Every token registered by a Member, for a push that Member should get.
    pub fn for_member(&self, member: &str) -> Vec<PushToken> {
        self.tokens
            .lock()
            .expect("push tokens")
            .iter()
            .filter(|held| held.member == member)
            .cloned()
            .collect()
    }

    /// Every token, for an Owner-level notice.
    pub fn all(&self) -> Vec<PushToken> {
        self.tokens.lock().expect("push tokens").clone()
    }

    fn save(&self) -> Result<(), PushTokenError> {
        let tokens = self.tokens.lock().expect("push tokens");
        let value = serde_json::to_value(&*tokens).unwrap_or(Value::Array(Vec::new()));
        write_json_file(&self.file, &value)?;
        let _ = fs::set_permissions(&self.file, fs::Permissions::from_mode(0o600));
        Ok(())
    }
}

/// The shape Expo gives a device push token.
pub fn is_expo_token(token: &str) -> bool {
    token.len() <= 256
        && token.starts_with("ExponentPushToken[")
        && token.ends_with(']')
        && token.len() > "ExponentPushToken[]".len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn token() -> PushTokens {
        let home = tempdir().expect("home");
        PushTokens::open(home.path()).expect("open")
    }

    #[test]
    fn a_token_is_kept_per_controller_key_and_reloads() {
        let home = tempdir().expect("home");
        let tokens = PushTokens::open(home.path()).expect("open");
        tokens
            .register("m_1", "key-1", "ExponentPushToken[a]", "th", 10)
            .expect("register");
        tokens
            .register("m_1", "key-2", "ExponentPushToken[b]", "en", 11)
            .expect("register");

        let reloaded = PushTokens::open(home.path()).expect("reload");
        assert_eq!(reloaded.for_member("m_1").len(), 2);
        assert_eq!(reloaded.for_member("m_1")[0].language, "th");
    }

    #[test]
    fn registering_again_replaces_the_old_token_of_that_key() {
        let tokens = token();
        tokens
            .register("m_1", "key-1", "ExponentPushToken[old]", "th", 1)
            .expect("register");
        tokens
            .register("m_1", "key-1", "ExponentPushToken[new]", "en", 2)
            .expect("replace");
        let held = tokens.for_member("m_1");
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].token, "ExponentPushToken[new]");
    }

    #[test]
    fn a_revocation_drops_only_the_keys_it_names() {
        let tokens = token();
        tokens
            .register("m_1", "key-1", "ExponentPushToken[a]", "th", 1)
            .expect("register");
        tokens
            .register("m_1", "key-2", "ExponentPushToken[b]", "th", 1)
            .expect("register");
        tokens.remove_devices(&["key-1".into()]).expect("remove");
        let held = tokens.for_member("m_1");
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].device, "key-2");
    }

    #[test]
    fn only_an_expo_token_is_accepted() {
        let tokens = token();
        assert!(tokens
            .register("m_1", "key-1", "not-a-token", "th", 1)
            .is_err());
        assert!(tokens
            .register("m_1", "key-1", "ExponentPushToken[ok]", "fr", 1)
            .expect("register")
            .language
            == "en");
    }
}
