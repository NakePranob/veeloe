//! The Task slices: a Member's words, a sync, a list and a Stop, each routed to
//! the Agent's worker, and every answer signed back to the Member. Ported from
//! `packages/runtime-legacy/src/supervisor/{task-message,task-sync,task-list,task-stop}`
//! and the outbox in `supervisor/index.ts`.

use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::signer::{Outgoing, Signer};
use veeloe_runtime_core::{FromWorker, ToWorker};

use crate::agents::AgentRegistry;
use crate::hub_link::HubSender;
use crate::llm::HttpClient;
use crate::models;
use crate::providers::Provider;
use crate::trust::{FileSeenSequences, TrustError};
use crate::uploads::UploadError;
use crate::workers::Workers;

/// How many events one `task.events` frame carries.
///
/// The same number as the legacy runtime
/// (`packages/protocol-legacy/src/messages/task.ts`): a Member that pages in
/// through `task.sync` expects the same slices from either Runtime.
pub const TASK_EVENTS_PAGE: usize = 100;

/// What a slice was sent, once it has been verified: who sent it and its
/// envelope's signature for answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inbound {
    pub member: String,
    /// The Controller key that signed this envelope, when the sender has one.
    pub key: Option<String>,
    pub reference: String,
    pub task: Option<String>,
}

/// How a slice answers. Every envelope out is signed by the Machine and goes to
/// the Members named.
pub trait Outbox: Send + Sync {
    fn to_member(&self, member: &str, type_: &str, body: Value, task: Option<&str>);
    fn error(&self, to: &Inbound, code: &str) {
        self.to_member(
            &to.member,
            "error",
            json!({ "code": code, "ref": to.reference }),
            to.task.as_deref(),
        );
    }
}

/// The Machine's own outbox: signs with its key, counts its own envelopes, and
/// writes them on the Hub connection.
pub struct MachineOutbox {
    machine_key: String,
    signer: Signer,
    seen: Mutex<FileSeenSequences>,
    hub: HubSender,
}

impl MachineOutbox {
    pub fn new(home: &Path, secret_key: &[u8; 32], hub: HubSender) -> Result<Self, TrustError> {
        Ok(Self {
            machine_key: to_base64url(&public_key_of(secret_key)),
            signer: Signer::new(secret_key),
            seen: Mutex::new(FileSeenSequences::open(home)?),
            hub,
        })
    }
}

impl Outbox for MachineOutbox {
    fn to_member(&self, member: &str, type_: &str, body: Value, task: Option<&str>) {
        let seq = {
            let mut seen = self.seen.lock().expect("seen");
            seen.next(&self.machine_key)
        };
        let envelope = self.signer.sign(
            Outgoing {
                type_: type_.to_string(),
                to: None,
                recipients: Some(vec![member.to_string()]),
                task: task.map(str::to_string),
                member: None,
                body,
            },
            seq,
        );
        if let Ok(value) = serde_json::to_value(envelope) {
            self.hub.send(value);
        }
    }
}

/// What the Controller sees of this Machine's Agents. Never a Provider's URL or
/// key, only its name.
pub fn agents_listed(registry: &AgentRegistry, providers: &[Value], egress: &[String]) -> Value {
    let mut agents: Vec<Value> = Vec::new();
    let mut trash: Vec<Value> = Vec::new();
    for agent in registry.all().unwrap_or_default() {
        let mut value = json!({
            "id": agent.id,
            "name": agent.name,
            "provider": agent.provider,
            "model": agent.model,
            "allowlist": agent.allowlist,
            "approvalTimeoutS": agent.approval_timeout_s,
        });
        if let Some(character) = &agent.character {
            value["character"] = character.clone();
        }
        if let Some(budget) = agent.budget {
            value["budget"] = json!(budget);
        }
        // A deleted Agent keeps every field it had, so the Controller can show it
        // in the trash and bring it back (`agent-trash`).
        match (agent.deleted_at, agent.restore_until()) {
            (Some(deleted_at), Some(restore_until)) => {
                value["deletedAt"] = json!(deleted_at);
                value["restoreUntil"] = json!(restore_until);
                trash.push(value);
            }
            _ => agents.push(value),
        }
    }
    json!({ "agents": agents, "trash": trash, "providers": providers, "egress": egress })
}

fn agent_of(body: &Value) -> &str {
    body.get("agent")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// What a slice may read on this Machine. Borrowed, so nothing is copied per
/// message; the Provider key stays behind `providers` and never leaves it.
pub struct Machine<'a> {
    pub registry: &'a AgentRegistry,
    pub workers: &'a Workers,
    /// Task Provider/model pins; present in the real supervisor, absent in slices' tests.
    pub routes: Option<&'a crate::task_routes::TaskRoutes>,
    /// The Machine's Ed25519 seed, only for opening sealed Provider keys.
    pub secret_key: Option<&'a [u8; 32]>,
    pub uploads: Option<&'a crate::uploads::Uploads>,
    pub push_tokens: Option<&'a crate::push_tokens::PushTokens>,
    pub providers: &'a [Provider],
    pub egress: &'a [String],
    pub budgets: Option<&'a crate::usage::Budgets>,
    pub http: &'a dyn HttpClient,
}

/// `agent.*`, then `task.message`, `task.sync`, `task.stop` and `task.list`,
/// each to the Agent's worker (ADR 0021).
pub async fn dispatch(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    type_: &str,
    body: &Value,
) {
    let registry = machine.registry;
    let workers = machine.workers;
    let listed = || async {
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
            machine.egress,
        )
    };
    if type_ == "push.register" {
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
        return;
    }
    if type_ == "push.unregister" {
        let (Some(tokens), Some(device)) = (machine.push_tokens, from.key.as_deref()) else {
            return outbox.error(from, "push.unavailable");
        };
        match tokens.unregister(device) {
            Ok(_) => outbox.to_member(&from.member, "push.unregistered", json!({}), None),
            Err(_) => outbox.error(from, "push.invalid"),
        }
        return;
    }
    if type_ == "provider.add" {
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
            crate::tasks::agents_listed(registry, &models, machine.egress),
            None,
        );
        return;
    }
    if type_ == "file.chunk" {
        let Some(uploads) = machine.uploads else {
            return outbox.error(from, "attachment.unavailable");
        };
        let (Some(file), Some(index), Some(total), Some(data)) = (
            body.get("file").and_then(Value::as_str),
            body.get("index").and_then(Value::as_u64),
            body.get("total").and_then(Value::as_u64),
            body.get("data").and_then(Value::as_str),
        ) else {
            return outbox.error(from, "attachment.invalid");
        };
        let Ok(bytes) = veeloe_protocol::base64url::from_base64url(data) else {
            return outbox.error(from, "attachment.invalid");
        };
        match uploads.add(file, index as usize, total as usize, &bytes) {
            Ok(_) => {}
            Err(UploadError::TooLarge) => return outbox.error(from, "attachment.too_large"),
            Err(_) => return outbox.error(from, "attachment.invalid"),
        }
        return;
    }
    if type_ == "file.get" {
        let Ok(Some(agent)) = registry.get(agent_of(body)) else {
            return outbox.error(from, "agent.unknown");
        };
        let Some(task) = from.task.as_deref() else {
            return outbox.error(from, "task.unknown");
        };
        let (Some(path), Some(hash)) = (
            body.get("path").and_then(Value::as_str),
            body.get("hash").and_then(Value::as_str),
        ) else {
            return outbox.error(from, "attachment.invalid");
        };
        let Ok(workdir) = crate::agents::agent_dir(registry.home(), &agent.id) else {
            return outbox.error(from, "agent.unavailable");
        };
        let Ok(real) = std::fs::canonicalize(path) else {
            return outbox.error(from, "attachment.missing");
        };
        // The path the Agent offered is already real; resolve the folder too, or a
        // symlinked home (`/var` on macOS) would fail a prefix that is really inside it.
        let Ok(root) = std::fs::canonicalize(workdir.join("workdir")) else {
            return outbox.error(from, "agent.unavailable");
        };
        if !real.starts_with(root) {
            return outbox.error(from, "attachment.invalid");
        }
        let Ok(bytes) = std::fs::read(&real) else {
            return outbox.error(from, "attachment.missing");
        };
        if to_base64url(&Sha256::digest(&bytes)) != hash {
            return outbox.error(from, "attachment.invalid");
        }
        let chunk = 256 * 1024;
        let total = std::cmp::max(1, bytes.len().div_ceil(chunk));
        for index in 0..total {
            let start = index * chunk;
            let end = std::cmp::min(start + chunk, bytes.len());
            outbox.to_member(
                &from.member,
                "file.chunk",
                json!({
                    "file": hash,
                    "name": real.file_name().and_then(|name| name.to_str()).unwrap_or("file"),
                    "index": index,
                    "total": total,
                    "data": veeloe_protocol::base64url::to_base64url(&bytes[start..end]),
                }),
                Some(task),
            );
        }
        return;
    }
    if type_ == "machine.status" {
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
        return;
    }
    if type_ == "usage.list" {
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
        return;
    }
    if type_ == "memory.get" {
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
        return;
    }
    if type_ == "agent.list" {
        outbox.to_member(&from.member, "agent.listed", listed().await, None);
        return;
    }
    if type_ == "agent.delete" {
        let Some(id) = body.get("id").and_then(Value::as_str) else {
            return outbox.error(from, "agent.unknown");
        };
        let Some(existing) = registry.get(id).ok().flatten() else {
            return outbox.error(from, "agent.unknown");
        };
        // Deleting twice is not a second deletion: it must not move the 30 days.
        if existing.deleted() {
            return outbox.to_member(&from.member, "agent.listed", listed().await, None);
        }
        // Stop the worker first: the registry entry is what starts a new one.
        workers.stop(id);
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
        outbox.to_member(&from.member, "agent.listed", listed().await, None);
        return;
    }
    if type_ == "agent.restore" {
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
            return outbox.to_member(&from.member, "agent.listed", listed().await, None);
        }
        if registry.restore(id).is_err() {
            return outbox.error(from, "agent.unknown");
        }
        if let Ok(Some(agent)) = registry.get(id) {
            workers.start(&agent);
        }
        let _ = crate::logs::record(
            registry.home(),
            "info",
            "agent.restore",
            json!({ "agent": id }),
        );
        outbox.to_member(&from.member, "agent.listed", listed().await, None);
        return;
    }
    if type_ == "agent.create" || type_ == "agent.update" {
        let Some(id) = body.get("id").and_then(Value::as_str) else {
            return outbox.error(from, "agent.unknown");
        };
        let existing = registry.get(id).ok().flatten();
        if type_ == "agent.create" && existing.is_some() {
            return outbox.error(from, "agent.exists");
        }
        // Settings of an Agent in the trash stay as they were until it is restored.
        if type_ == "agent.update" && existing.as_ref().is_some_and(|agent| agent.deleted()) {
            return outbox.error(from, "agent.unknown");
        }
        let base = existing.unwrap_or_else(|| crate::agents::Agent {
            id: id.to_string(),
            name: id.to_string(),
            provider: String::new(),
            model: String::new(),
            character: None,
            allowlist: Vec::new(),
            approval_timeout_s: 3_600,
            budget: None,
            deleted_at: None,
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
            approval_timeout_s: body
                .get("approvalTimeoutS")
                .and_then(Value::as_u64)
                .unwrap_or(base.approval_timeout_s),
            budget: body.get("budget").and_then(Value::as_u64).or(base.budget),
            deleted_at: base.deleted_at,
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
        let saved = if type_ == "agent.create" {
            registry.add(&next)
        } else {
            registry.replace(&next)
        };
        if saved.is_err() {
            return outbox.error(from, "agent.unknown");
        }
        if type_ == "agent.create" {
            workers.start(&next);
        } else {
            workers.rename(&next);
        }
        let _ = crate::logs::record(
            registry.home(),
            "info",
            if type_ == "agent.create" {
                "agent.create"
            } else {
                "agent.update"
            },
            json!({ "agent": id }),
        );
        outbox.to_member(&from.member, "agent.listed", listed().await, None);
        return;
    }
    if type_ == "task.list" {
        // Each Agent's worker answers with the Tasks this Member started, and
        // each answer goes back as its own `task.listed`. An Agent with no worker
        // right now says nothing, and the Controller asks again on its next connect.
        if let Ok(agents) = registry.all() {
            for agent in agents {
                workers.send(
                    &agent.id,
                    ToWorker::List {
                        member: from.member.clone(),
                    },
                );
            }
        }
        return;
    }

    let Ok(Some(agent)) = registry.get(agent_of(body)) else {
        return outbox.error(from, "agent.unknown");
    };
    // An Agent in the trash has no worker, and saying so is not an outage.
    if agent.deleted() {
        return outbox.error(from, "agent.unknown");
    }
    let Some(task) = from.task.clone() else {
        return outbox.error(from, "task.unknown");
    };

    match type_ {
        "task.message" => {
            if let Some(budgets) = machine.budgets {
                if budgets
                    .exhausted(&agent, crate::usage::now_ms())
                    .unwrap_or(false)
                {
                    return outbox.error(from, "budget.exhausted");
                }
            }
            let (Some(id), Some(text)) = (
                body.get("id").and_then(Value::as_str),
                body.get("text").and_then(Value::as_str),
            ) else {
                return outbox.error(from, "task.unknown");
            };
            let mut text = text.to_string();
            if let Some(attachments) = body.get("attachments").and_then(Value::as_array) {
                let Some(uploads) = machine.uploads else {
                    return outbox.error(from, "attachment.unavailable");
                };
                let workdir = match crate::agents::agent_dir(registry.home(), &agent.id) {
                    Ok(dir) => dir.join("workdir"),
                    Err(_) => return outbox.error(from, "agent.unavailable"),
                };
                let mut lines = Vec::new();
                for attachment in attachments {
                    let (Some(name), Some(size), Some(hash)) = (
                        attachment.get("name").and_then(Value::as_str),
                        attachment.get("size").and_then(Value::as_u64),
                        attachment.get("hash").and_then(Value::as_str),
                    ) else {
                        return outbox.error(from, "attachment.invalid");
                    };
                    let Some(bytes) = uploads.take(hash) else {
                        return outbox.error(from, "attachment.missing");
                    };
                    if bytes.len() as u64 != size {
                        return outbox.error(from, "attachment.invalid");
                    }
                    let Ok(path) = uploads.place(&bytes, &workdir, &task, name) else {
                        return outbox.error(from, "attachment.invalid");
                    };
                    lines.push(format!("- {} ({})", name, path.display()));
                }
                if !lines.is_empty() {
                    text.push_str("\n\nAttached files on this Machine:\n");
                    text.push_str(&lines.join("\n"));
                }
            }
            let sent = workers.send(
                &agent.id,
                ToWorker::Message {
                    task: task.clone(),
                    id: id.to_string(),
                    member: from.member.clone(),
                    text,
                    reference: from.reference.clone(),
                },
            );
            if !sent {
                outbox.error(from, "agent.unavailable");
            } else {
                let _ = crate::logs::record(
                    registry.home(),
                    "info",
                    "task.message",
                    json!({ "agent": agent.id, "task": task }),
                );
            }
        }
        "task.sync" => {
            let after = body.get("after").and_then(Value::as_i64).unwrap_or(0);
            let sent = workers.send(
                &agent.id,
                ToWorker::Sync {
                    task,
                    after,
                    member: from.member.clone(),
                    reference: from.reference.clone(),
                },
            );
            if !sent {
                outbox.error(from, "agent.unavailable");
            }
        }
        "task.stop" => {
            let Some(id) = body.get("id").and_then(Value::as_str) else {
                return outbox.error(from, "task.unknown");
            };
            let sent = workers.send(
                &agent.id,
                ToWorker::Stop {
                    task,
                    id: id.to_string(),
                    member: from.member.clone(),
                    reference: from.reference.clone(),
                },
            );
            if !sent {
                outbox.error(from, "agent.unavailable");
            }
        }
        "approval.answer" => {
            let Some(request) = body.get("request").and_then(Value::as_str) else {
                return outbox.error(from, "approval.unknown");
            };
            let Some(decision) = body.get("decision").and_then(Value::as_str) else {
                return outbox.error(from, "approval.unknown");
            };
            let decision = match decision {
                "approve" => veeloe_runtime_core::ApprovalDecision::Approve,
                "deny" => veeloe_runtime_core::ApprovalDecision::Deny,
                "redirect" => veeloe_runtime_core::ApprovalDecision::Redirect,
                _ => return outbox.error(from, "approval.unknown"),
            };
            // Allow-always grows the Allowlist too, in one write: the command may
            // have more than one part still asking.
            if let Some(allow_always) = body.get("allowAlways") {
                let entries: Vec<String> = match allow_always {
                    Value::String(entry) => vec![entry.clone()],
                    Value::Array(entries) => entries
                        .iter()
                        .filter_map(|entry| entry.as_str().map(str::to_string))
                        .collect(),
                    _ => Vec::new(),
                };
                let mut next = agent.clone();
                for entry in entries {
                    let entry = entry.trim().to_string();
                    if !entry.is_empty() && !next.allowlist.contains(&entry) {
                        next.allowlist.push(entry);
                    }
                }
                if next != agent {
                    let _ = registry.replace(&next);
                }
            }
            let sent = workers.send(
                &agent.id,
                ToWorker::Approval {
                    request: request.to_string(),
                    decision,
                    message: body
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    member: from.member.clone(),
                    reference: from.reference.clone(),
                    task: Some(task),
                },
            );
            if !sent {
                outbox.error(from, "agent.unavailable");
            }
        }
        _ => {}
    }
}

/// What a worker says, signed back to the Member it belongs to.
pub fn forward(outbox: &dyn Outbox, agent: &str, message: FromWorker) {
    match message {
        FromWorker::Event {
            task,
            starter,
            event,
        } => outbox.to_member(
            &starter,
            "task.event",
            json!({
                "agent": agent,
                "seq": event.seq,
                "kind": event.kind,
                "at": event.at,
                "body": event.body,
            }),
            Some(&task),
        ),
        FromWorker::Error {
            member,
            reference,
            code,
            task,
        } => outbox.to_member(
            &member,
            "error",
            json!({ "code": code, "ref": reference }),
            task.as_deref(),
        ),
        FromWorker::Tasks { member, tasks } => outbox.to_member(
            &member,
            "task.listed",
            json!({
                "tasks": tasks
                    .iter()
                    .map(|task| json!({ "id": task.id, "updated": task.updated, "agent": agent }))
                    .collect::<Vec<_>>(),
            }),
            None,
        ),
        FromWorker::Events {
            task,
            member,
            events,
        } => {
            for page in events.chunks(TASK_EVENTS_PAGE) {
                outbox.to_member(
                    &member,
                    "task.events",
                    json!({ "agent": agent, "events": page }),
                    Some(&task),
                );
            }
        }
        FromWorker::Ready | FromWorker::LlmRequest { .. } => {}
    }
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

#[cfg(test)]
mod tests {
    use super::TASK_EVENTS_PAGE;

    /// Ported from `packages/protocol-legacy/src/messages/task.ts`; a change
    /// here changes how a Member's `task.sync` catches up.
    #[test]
    fn a_task_events_frame_carries_the_legacy_page() {
        assert_eq!(TASK_EVENTS_PAGE, 100);
    }
}
