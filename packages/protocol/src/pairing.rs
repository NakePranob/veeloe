use std::collections::HashMap;

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::base64url::{from_base64url, to_base64url};
use crate::crypto::{public_key_base64url, sign_base64url, verify_signature};
use crate::hub_auth::{normalize_hub_url, HubUrlError};
use crate::uri::{decode_uri_component, encode_uri_component};

pub const PAIRING_TTL_SECONDS: u64 = 600;
pub const PAIRING_CLOCK_SKEW_SECONDS: u64 = 120;

const PREFIX: &str = "veeloe://pair?";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingLink {
    pub hub: String,
    pub machine: String,
    pub secret: String,
    pub expires: u64,
    pub sig: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PairingLinkError {
    #[error("malformed")]
    Malformed,
    #[error("bad-signature")]
    BadSignature,
    #[error("expired")]
    Expired,
}

/// What the Machine signs. The secret is deliberately not in it.
pub fn pairing_link_bytes(hub: &str, machine: &str, expires: u64) -> Result<Vec<u8>, HubUrlError> {
    Ok(format!(
        "veeloe-pairing-link/1\n{}\n{}\n{}",
        normalize_hub_url(hub)?,
        machine,
        expires
    )
    .into_bytes())
}

/// What the Controller signs. The Hub URL stops the signature being used at
/// another Hub.
pub fn pairing_request_bytes(
    hub: &str,
    machine: &str,
    controller: &str,
    expires: u64,
) -> Result<Vec<u8>, HubUrlError> {
    Ok(format!(
        "veeloe-pairing-request/1\n{}\n{}\n{}\n{}",
        normalize_hub_url(hub)?,
        machine,
        controller,
        expires
    )
    .into_bytes())
}

pub fn pairing_proof_text(machine: &str, controller: &str, member: &str) -> String {
    format!("veeloe-pairing-proof/1\n{}\n{}\n{}", machine, controller, member)
}

fn hmac_base64url(secret: &str, text: &str) -> Result<String, ()> {
    let key = from_base64url(secret).map_err(|_| ())?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| ())?;
    mac.update(text.as_bytes());
    Ok(to_base64url(&mac.finalize().into_bytes()))
}

pub fn pairing_proof(
    secret: &str,
    machine: &str,
    controller: &str,
    member: &str,
) -> Result<String, ()> {
    hmac_base64url(secret, &pairing_proof_text(machine, controller, member))
}

pub fn check_pairing_proof(
    secret: &str,
    machine: &str,
    controller: &str,
    member: &str,
    proof: &str,
) -> bool {
    match pairing_proof(secret, machine, controller, member) {
        Ok(expected) => constant_time_eq(&expected, proof),
        Err(()) => false,
    }
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

pub fn build_pairing_link(
    hub: &str,
    machine_secret_key: &[u8; 32],
    secret: &[u8; 32],
    expires: u64,
) -> Result<String, HubUrlError> {
    let hub = normalize_hub_url(hub)?;
    let machine = public_key_base64url(machine_secret_key);
    let sig = sign_base64url(machine_secret_key, &pairing_link_bytes(&hub, &machine, expires)?);
    Ok(format!(
        "{}hub={}&machine={}&secret={}&expires={}&sig={}",
        PREFIX,
        encode_uri_component(&hub),
        machine,
        to_base64url(secret),
        expires,
        sig
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

/// Reads what was scanned or pasted. Only a link the Machine really signed
/// comes back ok.
pub fn parse_pairing_link(text: &str, now_ms: u64) -> Result<PairingLink, PairingLinkError> {
    let trimmed = text.trim();
    let query = trimmed
        .strip_prefix(PREFIX)
        .ok_or(PairingLinkError::Malformed)?;

    let mut fields = HashMap::new();
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            if !key.is_empty() {
                fields.insert(key, value);
            }
        }
    }

    let machine = *fields.get("machine").ok_or(PairingLinkError::Malformed)?;
    let secret = *fields.get("secret").ok_or(PairingLinkError::Malformed)?;
    let expires_text = *fields.get("expires").ok_or(PairingLinkError::Malformed)?;
    let sig = *fields.get("sig").ok_or(PairingLinkError::Malformed)?;
    if !valid_expires(expires_text)
        || decoded_length(machine) != Some(32)
        || decoded_length(secret) != Some(32)
        || decoded_length(sig) != Some(64)
    {
        return Err(PairingLinkError::Malformed);
    }

    let hub = fields
        .get("hub")
        .and_then(|value| decode_uri_component(value))
        .ok_or(PairingLinkError::Malformed)?;
    let hub = normalize_hub_url(&hub).map_err(|_| PairingLinkError::Malformed)?;
    let expires: u64 = expires_text
        .parse()
        .map_err(|_| PairingLinkError::Malformed)?;

    let bytes = pairing_link_bytes(&hub, machine, expires).map_err(|_| PairingLinkError::Malformed)?;
    if !verify_signature(sig, &bytes, machine) {
        return Err(PairingLinkError::BadSignature);
    }
    if expires + PAIRING_CLOCK_SKEW_SECONDS < now_ms / 1000 {
        return Err(PairingLinkError::Expired);
    }

    Ok(PairingLink {
        hub,
        machine: machine.to_string(),
        secret: secret.to_string(),
        expires,
        sig: sig.to_string(),
    })
}

pub fn build_pairing_request(
    link: &PairingLink,
    controller_secret_key: &[u8; 32],
) -> Result<Value, HubUrlError> {
    let controller = public_key_base64url(controller_secret_key);
    let controller_sig = sign_base64url(
        controller_secret_key,
        &pairing_request_bytes(&link.hub, &link.machine, &controller, link.expires)?,
    );
    Ok(json!({
        "machine": link.machine,
        "controller": controller,
        "expires": link.expires,
        "machineSig": link.sig,
        "controllerSig": controller_sig,
    }))
}

/// Checks both signatures in a `POST /pairings` request against `hub`.
pub fn check_pairing_request(request: &Value, hub: &str) -> bool {
    let machine = match request.get("machine").and_then(Value::as_str) {
        Some(value) => value,
        None => return false,
    };
    let controller = match request.get("controller").and_then(Value::as_str) {
        Some(value) => value,
        None => return false,
    };
    let expires = match request.get("expires").and_then(Value::as_u64) {
        Some(value) => value,
        None => return false,
    };
    let machine_sig = match request.get("machineSig").and_then(Value::as_str) {
        Some(value) => value,
        None => return false,
    };
    let controller_sig = match request.get("controllerSig").and_then(Value::as_str) {
        Some(value) => value,
        None => return false,
    };

    let link_bytes = match pairing_link_bytes(hub, machine, expires) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let request_bytes = match pairing_request_bytes(hub, machine, controller, expires) {
        Ok(value) => value,
        Err(_) => return false,
    };
    verify_signature(machine_sig, &link_bytes, machine)
        && verify_signature(controller_sig, &request_bytes, controller)
}

/// Where to reach the Hub over HTTP: ws becomes http, wss becomes https.
pub fn hub_http_url(hub: &str) -> Result<String, HubUrlError> {
    Ok(normalize_hub_url(hub)?.replacen("ws", "http", 1))
}

