use serde_json::{Map, Value};

use crate::crypto::{public_key_base64url, sign_base64url, verify_signature};

/// A certificate is signed apart from any envelope, so it carries no `seq`: a
/// Machine that was off while the signer sent other envelopes still takes it.
pub fn sign_certificate(body: &Map<String, Value>, secret_key: &[u8; 32]) -> Value {
    let mut signed = Map::new();
    signed.insert("v".to_string(), Value::from(1));
    for (key, value) in body {
        signed.insert(key.clone(), value.clone());
    }
    signed.insert(
        "by".to_string(),
        Value::String(public_key_base64url(secret_key)),
    );
    let signed = serde_json::to_string(&Value::Object(signed)).expect("serialize certificate");
    serde_json::json!({
        "signed": signed,
        "sig": sign_base64url(secret_key, signed.as_bytes()),
    })
}

/// What the certificate says, when the key it names in `by` really signed it.
/// Whether that key is one to believe is the receiver's question, not this one's.
/// A type this build does not know reads as invalid, so it is skipped.
pub fn verify_certificate(certificate: &Value) -> Option<Value> {
    let signed = certificate.get("signed")?.as_str()?;
    let sig = certificate.get("sig")?.as_str()?;
    if signed.is_empty() || signed.len() > 4096 || sig.is_empty() {
        return None;
    }

    let body: Value = serde_json::from_str(signed).ok()?;
    let object = body.as_object()?;
    if object.get("v")?.as_u64()? != 1 {
        return None;
    }
    let workspace = object.get("workspace")?.as_str()?;
    let member = object.get("member")?.as_str()?;
    let key = object.get("key")?.as_str()?;
    let by = object.get("by")?.as_str()?;
    if workspace.is_empty() || member.is_empty() || key.is_empty() || by.is_empty() {
        return None;
    }
    object.get("at")?.as_u64()?;

    match object.get("type")?.as_str()? {
        "device.link" => {
            let name = object.get("name")?.as_str()?.trim();
            if name.is_empty() || name.len() > 80 {
                return None;
            }
        }
        "device.revoke" => {
            let keep = object.get("keep")?.as_array()?;
            if keep.len() > 100 || keep.iter().any(|value| value.as_str().is_none()) {
                return None;
            }
        }
        _ => return None,
    }

    if !verify_signature(sig, signed.as_bytes(), by) {
        return None;
    }
    Some(body)
}

/// Every key that stops being trusted when `revoked` is: it, and whatever it
/// linked, and so on down, except the keys kept.
pub fn revoked_with(revoked: &str, links: &[(String, String)], keep: &[String]) -> Vec<String> {
    let mut out = vec![revoked.to_string()];
    let mut index = 0;
    while index < out.len() {
        let current = out[index].clone();
        for (key, by) in links {
            if *by == current && !keep.contains(key) && !out.contains(key) {
                out.push(key.clone());
            }
        }
        index += 1;
    }
    out
}
