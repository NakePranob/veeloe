use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Value};
use url::{Host, Url};

use crate::base64url::to_base64url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid Hub URL")]
pub struct HubUrlError;

/// The form of a Hub URL that both sides sign: lower-case scheme and host, no
/// default port, no path. The Hub URL is in the signature so a Hub cannot pass
/// another Hub's challenge on and log in there as the client.
pub fn normalize_hub_url(hub: &str) -> Result<String, HubUrlError> {
    let url = Url::parse(hub).map_err(|_| HubUrlError)?;
    let scheme = url.scheme();
    if scheme != "ws" && scheme != "wss" {
        return Err(HubUrlError);
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().map(|query| !query.is_empty()).unwrap_or(false)
        || url.fragment().map(|fragment| !fragment.is_empty()).unwrap_or(false)
    {
        return Err(HubUrlError);
    }
    if url.path() != "" && url.path() != "/" {
        return Err(HubUrlError);
    }

    let host = match url.host() {
        Some(Host::Domain(domain)) => domain.to_string(),
        Some(Host::Ipv4(ip)) => ip.to_string(),
        Some(Host::Ipv6(ip)) => format!("[{}]", ip),
        None => return Err(HubUrlError),
    };
    let default_port = if scheme == "ws" { 80 } else { 443 };
    let port = match url.port() {
        Some(port) if port != default_port => format!(":{}", port),
        _ => String::new(),
    };

    Ok(format!("{}://{}{}", scheme, host, port))
}

/// The bytes a client signs to answer a challenge. The nonce goes in as its
/// base64url text.
pub fn handshake_bytes(hub: &str, nonce: &str) -> Result<Vec<u8>, HubUrlError> {
    Ok(format!(
        "veeloe-hub-auth/1\n{}\n{}",
        normalize_hub_url(hub)?,
        nonce
    )
    .into_bytes())
}

pub fn answer_challenge(
    hub: &str,
    nonce: &str,
    secret_key: &[u8; 32],
) -> Result<Value, HubUrlError> {
    let key = SigningKey::from_bytes(secret_key);
    let signature = key.sign(&handshake_bytes(hub, nonce)?);
    Ok(json!({
        "type": "hub.auth",
        "key": to_base64url(key.verifying_key().as_bytes()),
        "sig": to_base64url(&signature.to_bytes()),
    }))
}
