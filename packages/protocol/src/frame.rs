use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    Known { type_: String, value: Value },
    Unknown { type_: String },
    Invalid,
}

/// Reads one Hub frame. A type this build does not know is skipped, never a
/// failure (ADR 0023).
pub fn parse_frame(text: &str) -> Frame {
    let value: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return Frame::Invalid,
    };
    let type_ = match value.get("type").and_then(Value::as_str) {
        Some(type_) => type_.to_string(),
        None => return Frame::Invalid,
    };

    let valid = match type_.as_str() {
        "hub.challenge" => {
            value.get("v") == Some(&Value::from(1))
                && value
                    .get("nonce")
                    .and_then(Value::as_str)
                    .map(|nonce| nonce.len() >= 43)
                    .unwrap_or(false)
        }
        "hub.auth" => non_empty(&value, "key") && non_empty(&value, "sig"),
        "hub.ready" => {
            let machine = non_empty(&value, "machine");
            let member = non_empty(&value, "member");
            machine ^ member
        }
        "hub.error" => non_empty(&value, "code"),
        "hub.certificates" => value
            .get("certificates")
            .map(Value::is_array)
            .unwrap_or(false),
        "hub.link_request" => {
            non_empty(&value, "to")
                && non_empty(&value, "id")
                && non_empty(&value, "key")
                && non_empty(&value, "name")
                && non_empty(&value, "proof")
        }
        _ => return Frame::Unknown { type_ },
    };

    if valid {
        Frame::Known { type_, value }
    } else {
        Frame::Invalid
    }
}

fn non_empty(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|text| !text.is_empty())
        .unwrap_or(false)
}
