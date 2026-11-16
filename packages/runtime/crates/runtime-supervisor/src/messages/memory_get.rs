//! `memory.get`: an Agent's MEMORY.md, read only (`agent-memory-page`).

use serde_json::{json, Value};

use crate::tasks::{Inbound, Machine, Outbox};

/// Reads the Agent's memory without creating its Workdir.
pub(crate) fn get(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let registry = machine.registry;
    let Some(id) = body.get("agent").and_then(Value::as_str) else {
        return outbox.error(from, "agent.unknown");
    };
    if registry.get(id).ok().flatten().is_none() {
        return outbox.error(from, "agent.unknown");
    }
    // Read-only: the Workdir is not created, and an Agent in the trash reads
    // like `veeloe memory` reads it (`agent-memory-page`).
    let Ok(dir) = crate::agents::agent_root(registry.home(), id) else {
        return outbox.error(from, "agent.unknown");
    };
    let memory = veeloe_runtime_core::memory::read_memory(&dir.join("workdir"));
    outbox.to_member(
        &from.member,
        "memory.got",
        json!({
            "request": body.get("request").and_then(Value::as_str).unwrap_or_default(),
            "agent": id,
            "exists": memory.exists,
            "chars": memory.chars,
            "text": memory.text,
        }),
        None,
    );
}
