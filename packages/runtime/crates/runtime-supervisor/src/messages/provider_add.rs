//! `provider.add`: a Provider sent sealed from the Controller (ADR 0042).

use serde_json::Value;

use crate::tasks::{Inbound, Machine, Outbox};

/// Opens the sealed key, checks the Provider answers, saves it and lists again.
pub(crate) async fn add(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let registry = machine.registry;
    let Some(secret_key) = machine.secret_key else {
        return outbox.error(from, "provider.unavailable");
    };
    let (Some(name), Some(url), Some(key)) = (
        body.get("name").and_then(Value::as_str),
        body.get("url").and_then(Value::as_str),
        body.get("key").and_then(Value::as_str),
    ) else {
        return outbox.error(from, "provider.invalid");
    };
    let plaintext = match veeloe_protocol::sealed::open(secret_key, key) {
        Ok(plaintext) => plaintext,
        Err(_) => return outbox.error(from, "provider.invalid"),
    };
    let key = match String::from_utf8(plaintext) {
        Ok(key) => key,
        Err(_) => return outbox.error(from, "provider.invalid"),
    };
    let preset = body
        .get("preset")
        .and_then(Value::as_str)
        .map(str::to_string);
    let (auth, _) =
        match crate::models::detect_auth(url, &key, preset.as_deref(), machine.http).await {
            Ok(found) => found,
            Err(code) => return outbox.error(from, code),
        };
    let mut providers = machine.providers.to_vec();
    if providers.iter().any(|provider| provider.name == name) {
        return outbox.error(from, "provider.exists");
    }
    providers.push(crate::providers::Provider {
        name: name.to_string(),
        url: url.to_string(),
        key,
        auth,
        preset,
    });
    if crate::providers::save_providers(registry.home(), &providers).is_err() {
        return outbox.error(from, "provider.invalid");
    }
    let models = crate::models::info(&providers, machine.http).await;
    outbox.to_member(
        &from.member,
        "agent.listed",
        crate::tasks::agents_listed(registry, &models, machine.budgets),
        None,
    );
}
