//! `machine.status`: what the Controller shows of this Machine.

use serde_json::{json, Value};

use crate::tasks::{Inbound, Machine, Outbox};

/// The Machine's version, features, free disk and today's Budget.
pub(crate) fn status(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, _body: &Value) {
    let registry = machine.registry;
    // A deleted Agent's Budget is not part of today's limit (`agent-trash`).
    let agents: Vec<crate::agents::Agent> = registry
        .all()
        .unwrap_or_default()
        .into_iter()
        .filter(|agent| !agent.deleted())
        .collect();
    let today = crate::usage::budget_day(crate::usage::now_ms());
    let (used, limit) = machine.budgets.map_or((0, 0), |budgets| {
        let ids: Vec<String> = agents.iter().map(|agent| agent.id.clone()).collect();
        let used = budgets
            .range(&ids, &today, &today)
            .unwrap_or_default()
            .iter()
            .flat_map(|entry| entry.days.iter())
            .map(|day| day.tokens)
            .sum();
        let limit = agents.iter().filter_map(|agent| agent.budget).sum();
        (used, limit)
    });
    outbox.to_member(
        &from.member,
        "machine.status",
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "features": ["logs", "service", "delete-agent"],
            "lastError": Value::Null,
            "diskFreeBytes": disk_free_bytes(),
            "budgetToday": { "usedTokens": used, "limitTokens": limit },
        }),
        None,
    );
}

fn disk_free_bytes() -> u64 {
    use std::ffi::CString;

    let Ok(path) = std::env::current_dir() else {
        return 0;
    };
    let Ok(path) = CString::new(path.to_string_lossy().as_bytes()) else {
        return 0;
    };
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return 0;
    }
    (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64)
}
