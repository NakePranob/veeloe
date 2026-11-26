//! What more than one message handler needs. A handler never uses another
//! handler (ADR 0071); what they share lives here or in a service at `src/`.

use serde_json::{json, Value};

use crate::models;
use crate::tasks::{agents_listed, Machine};

/// Every Agent, after purging the trash past its 30 days.
pub(crate) async fn listed(machine: &Machine<'_>) -> Value {
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
    agents_listed(
        registry,
        &models::info(machine.providers, machine.http).await,
        machine.budgets,
    )
}
