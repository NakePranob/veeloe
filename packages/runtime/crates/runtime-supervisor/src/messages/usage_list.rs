//! `usage.list`: the tokens each Agent used, per day.

use serde_json::{json, Value};

use crate::tasks::{Inbound, Machine, Outbox};

/// The last `days` days (1 to 90) of one Agent, or every Agent.
pub(crate) fn list(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let registry = machine.registry;
    let days = body.get("days").and_then(Value::as_u64).unwrap_or(0);
    if !(1..=90).contains(&days) {
        return outbox.error(from, "usage.invalid_range");
    }
    let Some(budgets) = machine.budgets else {
        return outbox.error(from, "usage.invalid_range");
    };
    let to = crate::usage::budget_day(crate::usage::now_ms());
    let start = crate::usage::shift_day(&to, -((days as i64) - 1));
    let agents: Vec<String> = match body.get("agent").and_then(Value::as_str) {
        Some(id) => {
            if registry.get(id).ok().flatten().is_none() {
                return outbox.error(from, "agent.unknown");
            }
            vec![id.to_string()]
        }
        None => registry
            .all()
            .unwrap_or_default()
            .into_iter()
            .map(|agent| agent.id)
            .collect(),
    };
    let listed = budgets.range(&agents, &start, &to).unwrap_or_default();
    outbox.to_member(
        &from.member,
        "usage.listed",
        json!({
            "request": body.get("request").and_then(Value::as_str).unwrap_or_default(),
            "from": start,
            "to": to,
            "agents": listed,
        }),
        None,
    );
}
