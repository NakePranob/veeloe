//! `egress.set`: one Agent's Egress, or every Agent's (ADR 0029, issue #43).

use serde_json::Value;

use crate::egress::is_valid_egress;
use crate::messages::shared::listed;
use crate::tasks::{Inbound, Machine, Outbox};

/// Changes the Egress and answers with the new `agent.listed`.
pub(crate) async fn set(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let registry = machine.registry;
    // Changing an Agent's Egress is a Manage action (ADR 0029, 0010); every
    // Agent's at once is an Owner's.
    let Some(trust) = machine.trust else {
        return outbox.error(from, "egress.forbidden");
    };
    let allowed = match body.get("agent").and_then(Value::as_str) {
        Some(agent) => trust.manages(agent, &from.member, from.key.as_deref()),
        None => trust.is_owner(&from.member, from.key.as_deref()),
    };
    if !allowed {
        return outbox.error(from, "egress.forbidden");
    }
    let Some(egress) = machine.egress else {
        return outbox.error(from, "egress.unavailable");
    };
    // Every entry must be a domain. Dropping the ones that are not would
    // change every Agent's way out to a list shorter than the Member sent,
    // so one bad entry refuses the whole request (issue #43 review).
    let Some(domains) = body
        .get("egress")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries
                .iter()
                .map(|entry| entry.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
        })
    else {
        return outbox.error(from, "egress.invalid_domain");
    };
    if !is_valid_egress(&domains) {
        return outbox.error(from, "egress.invalid_domain");
    }
    // With `agent`, only that Agent's list changes. Without it, the legacy
    // behaviour: every Agent's, until the Controller has a per-Agent screen.
    // An `agent` that is present but not a string names no Agent, so reading
    // it as absent would broadcast a request that meant one Agent: refuse it
    // instead (issue #43 review).
    let target = match body.get("agent") {
        None => None,
        Some(Value::String(agent)) => Some(agent.as_str()),
        Some(_) => return outbox.error(from, "egress.invalid_domain"),
    };
    let changed = match target {
        Some(agent) => {
            if registry.get(agent).ok().flatten().is_none() {
                return outbox.error(from, "agent.unknown");
            }
            egress.set_agent(agent, domains)
        }
        None => egress.set_all(domains),
    };
    match changed {
        Ok(Some(_)) => {
            outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
        }
        // An Agent that vanished between the check and the write is still
        // an unknown Agent, not a bad list.
        Ok(None) => outbox.error(
            from,
            if target.is_some() {
                "agent.unknown"
            } else {
                "egress.invalid_domain"
            },
        ),
        Err(_) => outbox.error(from, "egress.unavailable"),
    }
}
