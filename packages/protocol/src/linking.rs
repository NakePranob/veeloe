use std::collections::HashMap;

use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::base64url::{from_base64url, to_base64url};
use crate::hub_auth::{normalize_hub_url, HubUrlError};
use crate::uri::{decode_uri_component, encode_uri_component};

pub const LINKING_TTL_SECONDS: u64 = 600;
pub const PAIRING_CLOCK_SKEW_SECONDS: u64 = 120;

const PREFIX: &str = "veeloe://link?";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkingLink {
    pub hub: String,
    pub to: String,
    pub id: String,
    pub secret: String,
    pub expires: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LinkingLinkError {
    #[error("malformed")]
    Malformed,
    #[error("expired")]
    Expired,
}

pub fn build_linking_link(
    hub: &str,
    to: &str,
    id: &str,
    secret: &[u8; 32],
    expires: u64,
) -> Result<String, HubUrlError> {
    let hub = normalize_hub_url(hub)?;
    Ok(format!(
        "{}hub={}&to={}&id={}&secret={}&exp={}",
        PREFIX,
        encode_uri_component(&hub),
        to,
        id,
        to_base64url(secret),
        expires
    ))
}

fn decoded_length(text: &str) -> Option<usize> {
    from_base64url(text).ok().map(|bytes| bytes.len())
}

fn valid_expires(text: &str) -> bool {
    let mut bytes = text.bytes();
    matches!(bytes.next(), Some(b'1'..=b'9'))
        && bytes.all(|byte| byte.is_ascii_digit())
        && text.len() <= 15
}

pub fn parse_linking_link(text: &str, now_ms: u64) -> Result<LinkingLink, LinkingLinkError> {
    let trimmed = text.trim();
    let query = trimmed
        .strip_prefix(PREFIX)
        .ok_or(LinkingLinkError::Malformed)?;

    let mut fields = HashMap::new();
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            if !key.is_empty() {
                fields.insert(key, value);
            }
        }
    }

    let to = *fields.get("to").ok_or(LinkingLinkError::Malformed)?;
    let id = *fields.get("id").ok_or(LinkingLinkError::Malformed)?;
    let secret = *fields.get("secret").ok_or(LinkingLinkError::Malformed)?;
    let expires_text = *fields.get("exp").ok_or(LinkingLinkError::Malformed)?;
    if !valid_expires(expires_text)
        || decoded_length(to) != Some(32)
        || decoded_length(id) != Some(16)
        || decoded_length(secret) != Some(32)
    {
        return Err(LinkingLinkError::Malformed);
    }

    let hub = fields
        .get("hub")
        .and_then(|value| decode_uri_component(value))
        .ok_or(LinkingLinkError::Malformed)?;
    let hub = normalize_hub_url(&hub).map_err(|_| LinkingLinkError::Malformed)?;
    let expires: u64 = expires_text
        .parse()
        .map_err(|_| LinkingLinkError::Malformed)?;
    if expires + PAIRING_CLOCK_SKEW_SECONDS < now_ms / 1000 {
        return Err(LinkingLinkError::Expired);
    }

    Ok(LinkingLink {
        hub,
        to: to.to_string(),
        id: id.to_string(),
        secret: secret.to_string(),
        expires,
    })
}

fn hmac_base64url(secret: &str, text: &str) -> Result<String, ()> {
    let key = from_base64url(secret).map_err(|_| ())?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| ())?;
    mac.update(text.as_bytes());
    Ok(to_base64url(&mac.finalize().into_bytes()))
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in a.bytes().zip(b.bytes()) {
        difference |= left ^ right;
    }
    difference == 0
}

/// `name` goes last: `id` and `key` are base64url, so no name can pass for
/// another split.
pub fn link_request_proof_text(id: &str, key: &str, name: &str) -> String {
    format!("veeloe-link-request/1\n{}\n{}\n{}", id, key, name)
}

pub fn link_request_proof(
    secret: &str,
    id: &str,
    key: &str,
    name: &str,
) -> Result<String, ()> {
    hmac_base64url(secret, &link_request_proof_text(id, key, name))
}

pub fn check_link_request_proof(
    secret: &str,
    id: &str,
    key: &str,
    name: &str,
    proof: &str,
) -> bool {
    match link_request_proof(secret, id, key, name) {
        Ok(expected) => constant_time_eq(&expected, proof),
        Err(()) => false,
    }
}

pub fn linking_proof_text(key: &str, data: &str) -> String {
    format!("veeloe-link/1\n{}\n{}", key, data)
}

pub fn linking_proof(secret: &str, key: &str, data: &str) -> Result<String, ()> {
    hmac_base64url(secret, &linking_proof_text(key, data))
}

pub fn check_linking_proof(secret: &str, key: &str, data: &str, proof: &str) -> bool {
    match linking_proof(secret, key, data) {
        Ok(expected) => constant_time_eq(&expected, proof),
        Err(()) => false,
    }
}

/// What a handoff's `data` must hold once its proof checked out: where the
/// Machines are and the Member's other keys. A loose object, as
/// `HandoffDataSchema` reads it — unknown fields are left alone.
pub fn is_handoff_data(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !non_empty_text(object.get("workspace")) || !non_empty_text(object.get("member")) {
        return false;
    }
    let machine_ok = |entry: &Value| {
        entry.as_object().is_some_and(|entry| {
            ["id", "key", "hub"]
                .iter()
                .all(|field| non_empty_text(entry.get(*field)))
                && entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| (1..=255).contains(&name.chars().count()))
        })
    };
    let key_ok = |entry: &Value| {
        entry.as_object().is_some_and(|entry| {
            non_empty_text(entry.get("key"))
                && match entry.get("name") {
                    None => true,
                    Some(name) => name.as_str().is_some_and(|name| name.chars().count() <= 80),
                }
        })
    };
    let arrays_ok = |field: &str, check: &dyn Fn(&Value) -> bool| {
        object
            .get(field)
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().all(|item| check(item)))
    };
    arrays_ok("machines", &machine_ok) && arrays_ok("keys", &key_ok)
}

fn non_empty_text(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|text| !text.is_empty())
}
