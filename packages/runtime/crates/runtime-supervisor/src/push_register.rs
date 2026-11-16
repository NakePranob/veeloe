//! `push.register` and `push.unregister`: this device's push token.

use serde_json::{json, Value};

use crate::tasks::{Inbound, Machine, Outbox};

/// Holds the device's token for this Member.
pub(crate) fn register(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let (Some(tokens), Some(device)) = (machine.push_tokens, from.key.as_deref()) else {
        return outbox.error(from, "push.unavailable");
    };
    let (Some(token), language) = (
        body.get("token").and_then(Value::as_str),
        body.get("language").and_then(Value::as_str).unwrap_or("en"),
    ) else {
        return outbox.error(from, "push.invalid");
    };
    match tokens.register(
        &from.member,
        device,
        token,
        language,
        crate::usage::now_ms() as u64,
    ) {
        Ok(held) => outbox.to_member(
            &from.member,
            "push.registered",
            json!({ "token": held.token }),
            None,
        ),
        Err(_) => outbox.error(from, "push.invalid"),
    }
}

/// Forgets the device's token.
pub(crate) fn unregister(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    _body: &Value,
) {
    let (Some(tokens), Some(device)) = (machine.push_tokens, from.key.as_deref()) else {
        return outbox.error(from, "push.unavailable");
    };
    match tokens.unregister(device) {
        Ok(_) => outbox.to_member(&from.member, "push.unregistered", json!({}), None),
        Err(_) => outbox.error(from, "push.invalid"),
    }
}
