//! `agent.list`, `agent.delete`, `agent.restore`, `agent.create` and
//! `agent.update`: the Agents on this Machine and their settings.

use serde_json::{json, Value};

use crate::messages::shared::listed;
use crate::models;
use crate::tasks::{Inbound, Machine, Outbox};

/// Lists the Agents.
pub(crate) async fn list(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    _body: &Value,
) {
    outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
}

/// Moves an Agent to the trash, stopping its worker and proxy.
pub(crate) async fn delete(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    let registry = machine.registry;
    let workers = machine.workers;
    let Some(id) = body.get("id").and_then(Value::as_str) else {
        return outbox.error(from, "agent.unknown");
    };
    let Some(existing) = registry.get(id).ok().flatten() else {
        return outbox.error(from, "agent.unknown");
    };
    // Deleting twice is not a second deletion: it must not move the 30 days.
    if existing.deleted() {
        return outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
    }
    // Stop the worker first: the registry entry is what starts a new one.
    workers.stop(id);
    // Its listener goes with it, so nothing answers for an Agent in the
    // trash (ADR 0029, issue #43).
    if let Some(proxies) = machine.proxies {
        proxies.stop(id);
    }
    if registry.soft_delete(id, crate::usage::now_ms()).is_err() {
        return outbox.error(from, "agent.unknown");
    }
    if let Some(routes) = machine.routes {
        let _ = routes.forget(id);
    }
    let _ = crate::logs::record(
        registry.home(),
        "info",
        "agent.trash",
        json!({ "agent": id }),
    );
    outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
}

/// Brings an Agent back from the trash and starts it again.
pub(crate) async fn restore(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    let registry = machine.registry;
    let workers = machine.workers;
    let Some(id) = body.get("id").and_then(Value::as_str) else {
        return outbox.error(from, "agent.unknown");
    };
    let _ = registry.purge_expired(crate::usage::now_ms());
    let Some(existing) = registry.get(id).ok().flatten() else {
        return outbox.error(from, "agent.unknown");
    };
    // Restoring an Agent that is not in the trash says so by doing nothing;
    // a Controller that retries after a lost answer gets the same list.
    if !existing.deleted() {
        return outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
    }
    if registry.restore(id).is_err() {
        return outbox.error(from, "agent.unknown");
    }
    if let Ok(Some(agent)) = registry.get(id) {
        if let Some(proxies) = machine.proxies {
            if let Err(error) = proxies.ensure(&agent.id).await {
                let _ = crate::logs::record(
                    registry.home(),
                    "warn",
                    "agent.proxy_failed",
                    json!({ "agent": agent.id.clone(), "reason": error.to_string() }),
                );
            }
        }
        workers.start(&agent);
    }
    let _ = crate::logs::record(
        registry.home(),
        "info",
        "agent.restore",
        json!({ "agent": id }),
    );
    outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
}

/// A new Agent; `agent.exists` when the id is taken.
pub(crate) async fn create(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    save(machine, outbox, from, body, true).await
}

/// New settings for an Agent that is not in the trash.
pub(crate) async fn update(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    save(machine, outbox, from, body, false).await
}

async fn save(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
    create: bool,
) {
    let registry = machine.registry;
    let workers = machine.workers;
    let Some(id) = body.get("id").and_then(Value::as_str) else {
        return outbox.error(from, "agent.unknown");
    };
    let existing = registry.get(id).ok().flatten();
    if create && existing.is_some() {
        return outbox.error(from, "agent.exists");
    }
    // Settings of an Agent in the trash stay as they were until it is restored.
    if !create && existing.as_ref().is_some_and(|agent| agent.deleted()) {
        return outbox.error(from, "agent.unknown");
    }
    // Which repos an Agent may push to is a Manage action, like its Egress
    // (ADR 0029, 0069): in v0.1 an Owner whose key signed.
    let git_repos: Option<Vec<String>> = match body.get("gitRepos") {
        None => None,
        Some(repos) => {
            if !machine
                .trust
                .is_some_and(|trust| trust.manages(&from.member, from.key.as_deref()))
            {
                return outbox.error(from, "git.forbidden");
            }
            let repos: Option<Vec<String>> = repos.as_array().and_then(|repos| {
                repos
                    .iter()
                    .map(|repo| {
                        repo.as_str()
                            .filter(|repo| crate::git_broker::is_repo(repo))
                            .map(str::to_ascii_lowercase)
                    })
                    .collect()
            });
            // One bad entry refuses the whole list, as Egress does.
            let Some(mut repos) = repos else {
                return outbox.error(from, "git.invalid_repo");
            };
            repos.sort();
            repos.dedup();
            Some(repos)
        }
    };
    let base = existing.unwrap_or_else(|| crate::agents::Agent {
        id: id.to_string(),
        name: id.to_string(),
        provider: String::new(),
        model: String::new(),
        character: None,
        allowlist: Vec::new(),
        // A new Agent starts with no way out, not the list it was created
        // beside: only the migration copies an old Machine list (#43).
        egress: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
        git_repos: Vec::new(),
        background_share: None,
    });
    let text = |name: &str, fallback: &str| {
        body.get(name)
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| fallback.to_string())
    };
    let next = crate::agents::Agent {
        id: id.to_string(),
        name: text("name", &base.name),
        provider: text("provider", &base.provider),
        model: text("model", &base.model),
        character: body.get("character").cloned().or(base.character),
        allowlist: body
            .get("allowlist")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or(base.allowlist),
        // Egress changes only through `egress.set`, which checks Manage and
        // knows about the Controller's legacy list (issue #43).
        egress: base.egress,
        approval_timeout_s: body
            .get("approvalTimeoutS")
            .and_then(Value::as_u64)
            .unwrap_or(base.approval_timeout_s),
        budget: body.get("budget").and_then(Value::as_u64).or(base.budget),
        deleted_at: base.deleted_at,
        git_repos: git_repos.unwrap_or(base.git_repos),
        background_share: body
            .get("backgroundShare")
            .and_then(Value::as_u64)
            .or(base.background_share),
    };
    // A new Agent must name a Provider on this Machine and a model that
    // Provider lists; an update may move either, so both are checked again.
    let Some(provider) = machine
        .providers
        .iter()
        .find(|provider| provider.name == next.provider)
    else {
        return outbox.error(from, "agent.provider_unknown");
    };
    let known = models::list(provider, machine.http)
        .await
        .unwrap_or_default()
        .iter()
        .any(|model| model["id"] == next.model);
    if !known {
        return outbox.error(from, "agent.provider_unknown");
    }
    let saved = if create {
        registry.add(&next)
    } else {
        registry.replace(&next)
    };
    if saved.is_err() {
        return outbox.error(from, "agent.unknown");
    }
    if create {
        // An id that was used, purged and used again starts empty, not with
        // what the old Agent's row held (issue #43).
        if let Some(egress) = machine.egress {
            egress.forget(&next.id);
        }
        // Its own listener before its worker: a worker with no way out is
        // not started at all (issue #43).
        if let Some(proxies) = machine.proxies {
            if let Err(error) = proxies.ensure(&next.id).await {
                let _ = crate::logs::record(
                    registry.home(),
                    "warn",
                    "agent.proxy_failed",
                    json!({ "agent": next.id.clone(), "reason": error.to_string() }),
                );
            }
        }
        workers.start(&next);
    } else {
        workers.rename(&next);
    }
    let _ = crate::logs::record(
        registry.home(),
        "info",
        if create {
            "agent.create"
        } else {
            "agent.update"
        },
        json!({ "agent": id }),
    );
    outbox.to_member(&from.member, "agent.listed", listed(machine).await, None);
}
