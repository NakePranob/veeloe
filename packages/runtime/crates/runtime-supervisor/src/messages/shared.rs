//! What more than one message handler needs. A handler never uses another
//! handler (ADR 0071); what they share lives here or in a service at `src/`.

use serde_json::{json, Value};

use crate::models;
use crate::tasks::{agents_listed, listed_for, Inbound, Machine};

/// The Agents this Member is told of, after purging the trash past its 30 days.
pub(crate) async fn listed(machine: &Machine<'_>, from: &Inbound) -> Value {
    let registry = machine.registry;
    // A list is the only clock the trash needs: no timer, and a Machine that
    // was off past the 30 days purges as soon as it is asked (`agent-trash`).
    if let Ok(purged) = registry.purge_expired(crate::usage::now_ms()) {
        if purged > 0 {
            let _ = crate::logs::record(
                registry.home(),
                "warn",
                "agent.purge",
                json!({ "agents": purged }),
            );
        }
    }
    let body = agents_listed(
        registry,
        &models::info(machine.providers, machine.http).await,
        machine.budgets,
    );
    match machine.trust {
        Some(trust) => listed_for(&body, trust, &from.member, from.key.as_deref()),
        // A slice's test with no trust sees everything, as it always did.
        None => body,
    }
}
