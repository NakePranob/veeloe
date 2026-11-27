use std::collections::{HashMap, HashSet};

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::base64url::from_base64url;

/// The largest integer a JavaScript peer can carry without losing precision.
const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

/// The routing header the Hub reads, plus the signed bytes and signature.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Envelope {
    pub v: u8,
    #[serde(rename = "type")]
    pub type_: String,
    pub from: String,
    pub signed: String,
    pub sig: String,
    // A field that is not set is left out, never written as null: a reader's
    // schema says `to` is a non-empty string or absent (ADR 0019, 0023).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipients: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<String>,
}

impl Envelope {
    fn validate(&self) -> Result<(), Rejection> {
        if self.v != 1 || self.type_.is_empty() || self.from.is_empty() || self.sig.is_empty() {
            return Err(Rejection::Malformed);
        }
        if let Some(to) = &self.to {
            if to.is_empty() {
                return Err(Rejection::Malformed);
            }
        }
        if let Some(recipients) = &self.recipients {
            if recipients.is_empty() || recipients.iter().any(String::is_empty) {
                return Err(Rejection::Malformed);
            }
        }
        match (&self.to, &self.recipients) {
            (Some(_), None) | (None, Some(_)) => Ok(()),
            _ => Err(Rejection::Malformed),
        }
    }
}

/// What the sender signed: copies of the routing header, its counter, and the
/// body. The carried `signed` string is the exact JSON text, never re-encoded.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SignedPart {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub recipients: Option<Vec<String>>,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub member: Option<String>,
    pub seq: u64,
    pub body: Value,
}

impl SignedPart {
    fn validate(&self) -> Result<(), Rejection> {
        if self.type_.is_empty() || self.seq == 0 || self.seq > MAX_SAFE_SEQUENCE {
            return Err(Rejection::Malformed);
        }
        if let Some(to) = &self.to {
            if to.is_empty() {
                return Err(Rejection::Malformed);
            }
        }
        if let Some(recipients) = &self.recipients {
            if recipients.is_empty() || recipients.iter().any(String::is_empty) {
                return Err(Rejection::Malformed);
            }
        }
        Ok(())
    }
}

/// One destination, or the Members who may see the message (ADR 0034).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    To(String),
    Recipients(Vec<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Rejection {
    #[error("malformed")]
    Malformed,
    #[error("untrusted-key")]
    UntrustedKey,
    #[error("bad-signature")]
    BadSignature,
    #[error("header-mismatch")]
    HeaderMismatch,
    #[error("not-addressed")]
    NotAddressed,
    #[error("replayed")]
    Replayed,
}

#[derive(Debug, Clone)]
pub struct Verified {
    pub from: String,
    pub signed: SignedPart,
}

/// The last sequence number accepted from each sender key.
pub trait SeenSequences {
    fn last(&self, sender: &str) -> Option<u64>;
    fn record(&mut self, sender: &str, seq: u64);
    /// Whether `seq` was never accepted from `sender`. By default only a
    /// number above the last one is; a store that keeps a [`Window`] also takes
    /// one that came late by the slower of two paths (ADR 0090).
    fn is_new(&self, sender: &str, seq: u64) -> bool {
        self.last(sender).is_none_or(|last| seq > last)
    }
}

/// How many of the latest numbers from one sender may still arrive out of
/// order (ADR 0090). An envelope later than this is refused as replayed.
pub const SEEN_WINDOW: usize = 1024;

/// The numbers accepted from each sender in this run, so that an envelope that
/// took the Hub while the next one took the direct link is accepted once and
/// only once (ADR 0090). Only the highest number is kept on disk: after a
/// restart, everything at or below it is refused, as before.
#[derive(Debug, Default)]
pub struct Window {
    senders: HashMap<String, Recent>,
}

#[derive(Debug)]
struct Recent {
    /// Everything at or below this is refused.
    floor: u64,
    accepted: std::collections::BTreeSet<u64>,
}

impl Window {
    /// Whether `seq` is new from a sender whose highest kept number is `last`.
    pub fn is_new(&self, sender: &str, seq: u64, last: Option<u64>) -> bool {
        match self.senders.get(sender) {
            Some(recent) => seq > recent.floor && !recent.accepted.contains(&seq),
            None => last.is_none_or(|last| seq > last),
        }
    }

    /// Remembers `seq`, for a sender whose highest kept number was `last`
    /// before it.
    pub fn record(&mut self, sender: &str, seq: u64, last: Option<u64>) {
        let recent = self.senders.entry(sender.to_string()).or_insert(Recent {
            floor: last.unwrap_or(0),
            accepted: Default::default(),
        });
        recent.accepted.insert(seq);
        while recent.accepted.len() > SEEN_WINDOW {
            if let Some(oldest) = recent.accepted.pop_first() {
                recent.floor = recent.floor.max(oldest);
            }
        }
    }
}

#[derive(Debug, Default)]
pub struct MemorySeenSequences {
    last: HashMap<String, u64>,
}

impl SeenSequences for MemorySeenSequences {
    fn last(&self, sender: &str) -> Option<u64> {
        self.last.get(sender).copied()
    }

    fn record(&mut self, sender: &str, seq: u64) {
        self.last.insert(sender.to_string(), seq);
    }
}

/// The receiver's checks, in order (ADR 0019): a trusted sender key, a valid
/// signature over the carried bytes, and only then parsing — then the header
/// must match its signed copy, the envelope must be meant for this receiver and
/// the counter must have gone up. The counter comes last, so that no rejected
/// envelope moves it.
pub fn verify<F>(
    envelope: &Value,
    trusted_keys: &HashSet<String>,
    is_for_me: F,
    seen: &mut dyn SeenSequences,
) -> Result<Verified, Rejection>
where
    F: Fn(&Route) -> bool,
{
    verify_with(envelope, |key| trusted_keys.contains(key), is_for_me, seen)
}

/// A sender's key checked by something other than the trust list, for the one
/// wait that has nobody trusted yet: the new device waiting for its handoff
/// checks the HMAC over the data instead (ADR 0031). Everything else is the
/// same as `verify`.
pub fn verify_any_key<F>(
    envelope: &Value,
    is_for_me: F,
    seen: &mut dyn SeenSequences,
) -> Result<Verified, Rejection>
where
    F: Fn(&Route) -> bool,
{
    verify_with(envelope, |_| true, is_for_me, seen)
}

fn verify_with<F, T>(
    envelope: &Value,
    is_trusted: T,
    is_for_me: F,
    seen: &mut dyn SeenSequences,
) -> Result<Verified, Rejection>
where
    F: Fn(&Route) -> bool,
    T: Fn(&str) -> bool,
{
    let header: Envelope =
        serde_json::from_value(envelope.clone()).map_err(|_| Rejection::Malformed)?;
    header.validate()?;

    if !is_trusted(&header.from) {
        return Err(Rejection::UntrustedKey);
    }

    let public_key = from_base64url(&header.from).map_err(|_| Rejection::BadSignature)?;
    let signature = from_base64url(&header.sig).map_err(|_| Rejection::BadSignature)?;
    let key_bytes: [u8; 32] = public_key
        .as_slice()
        .try_into()
        .map_err(|_| Rejection::BadSignature)?;
    let verifying_key =
        VerifyingKey::from_bytes(&key_bytes).map_err(|_| Rejection::BadSignature)?;
    let signature = Signature::from_slice(&signature).map_err(|_| Rejection::BadSignature)?;
    verifying_key
        .verify_strict(header.signed.as_bytes(), &signature)
        .map_err(|_| Rejection::BadSignature)?;

    let part: SignedPart =
        serde_json::from_str(&header.signed).map_err(|_| Rejection::Malformed)?;
    part.validate()?;

    if header.type_ != part.type_
        || header.to != part.to
        || header.recipients != part.recipients
        || header.task != part.task
        || header.member != part.member
    {
        return Err(Rejection::HeaderMismatch);
    }

    let route = if let Some(to) = &part.to {
        Route::To(to.clone())
    } else if let Some(recipients) = &part.recipients {
        Route::Recipients(recipients.clone())
    } else {
        return Err(Rejection::Malformed);
    };
    if !is_for_me(&route) {
        return Err(Rejection::NotAddressed);
    }

    if !seen.is_new(&header.from, part.seq) {
        return Err(Rejection::Replayed);
    }
    seen.record(&header.from, part.seq);

    Ok(Verified {
        from: header.from,
        signed: part,
    })
}

#[cfg(test)]
mod window_tests {
    use super::*;

    #[test]
    fn a_late_number_is_taken_once_and_a_replay_never() {
        let mut window = Window::default();
        // Restarted with 10 kept: nothing at or below it is new.
        assert!(!window.is_new("k", 10, Some(10)));
        assert!(window.is_new("k", 12, Some(10)));
        window.record("k", 12, Some(10));
        // 11 took the slower path: still new, once.
        assert!(window.is_new("k", 11, Some(12)));
        window.record("k", 11, Some(12));
        assert!(!window.is_new("k", 11, Some(12)));
        assert!(!window.is_new("k", 12, Some(12)));
        assert!(!window.is_new("k", 10, Some(12)));
    }

    #[test]
    fn a_number_older_than_the_window_is_refused() {
        let mut window = Window::default();
        for seq in 2..=(SEEN_WINDOW as u64 + 2) {
            window.record("k", seq, Some(seq - 1));
        }
        // 1 was never taken, but more than a window of numbers came after it.
        assert!(!window.is_new("k", 1, Some(SEEN_WINDOW as u64 + 2)));
        assert!(window.is_new("k", SEEN_WINDOW as u64 + 3, None));
    }
}
