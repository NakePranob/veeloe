//! Every message a Member sends, routed by type to the module that answers it
//! (`agent_config`, `task_message`, `usage_list`, ...), and the outbox that
//! signs each answer back to the Member. The outbox is ported from
//! `supervisor/index.ts`.

use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::signer::{Outgoing, Signer};
use veeloe_runtime_core::FromWorker;

use crate::agents::AgentRegistry;
use crate::approval::Approvals;
use crate::egress::Egress;
use crate::hub_link::HubSender;
use crate::llm::HttpClient;
use crate::messages::{
    agent_config, egress_set, file_transfer, machine_status, memory_get, provider_add,
    push_register, task_message, usage_list,
};
use crate::providers::Provider;
use crate::proxy::Proxies;
use crate::trust::{FileSeenSequences, Trust, TrustError};
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
///
/// Each Agent carries its own Egress (ADR 0029, issue #43). The top-level `egress`
/// stays for a Controller that reads one list: it is the union of every Agent's,
/// which is exactly what each Agent's list was before the split and what the
/// legacy `egress.set` still sets everywhere.
pub fn agents_listed(registry: &AgentRegistry, providers: &[Value]) -> Value {
    let mut agents: Vec<Value> = Vec::new();
    let mut trash: Vec<Value> = Vec::new();
    let mut union: Vec<String> = Vec::new();
    for agent in registry.all().unwrap_or_default() {
        for domain in &agent.egress {
            if !union.contains(domain) {
                union.push(domain.clone());
            }
        }
        let mut value = json!({
            "id": agent.id,
            "name": agent.name,
            "provider": agent.provider,
            "model": agent.model,
            "allowlist": agent.allowlist,
            "egress": agent.egress,
            "gitRepos": agent.git_repos,
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
    json!({ "agents": agents, "trash": trash, "providers": providers, "egress": union })
}

pub(crate) fn agent_of(body: &Value) -> &str {
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
    /// Every Agent's Egress, written through `egress.set` (ADR 0029, #43).
    /// Absent in slices that do not test it; a real supervisor always has one.
    pub egress: Option<&'a Egress>,
    /// Who may change an Agent's settings: the Owner, in v0.1 (ADR 0010).
    /// Absent means nobody may, so a slice that cannot check refuses.
    pub trust: Option<&'a Trust>,
    /// The per-Agent proxies, so a new Agent gets its own listener and a
    /// deleted one loses it. Absent in slices that never start a worker.
    pub proxies: Option<&'a Proxies>,
    /// The domain Approvals the proxies are waiting on (issue #44). Absent in
    /// slices that never start a proxy.
    pub approvals: Option<&'a Approvals>,
    pub budgets: Option<&'a crate::usage::Budgets>,
    pub http: &'a dyn HttpClient,
}

/// Routes each message type to its module (ADR 0021).
pub async fn dispatch(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    type_: &str,
    body: &Value,
) {
    match type_ {
        "egress.set" => egress_set::set(machine, outbox, from, body).await,
        "push.register" => push_register::register(machine, outbox, from, body),
        "push.unregister" => push_register::unregister(machine, outbox, from, body),
        "provider.add" => provider_add::add(machine, outbox, from, body).await,
        "file.chunk" => file_transfer::chunk(machine, outbox, from, body),
        "file.get" => file_transfer::get(machine, outbox, from, body),
        "machine.status" => machine_status::status(machine, outbox, from, body),
        "usage.list" => usage_list::list(machine, outbox, from, body),
        "memory.get" => memory_get::get(machine, outbox, from, body),
        "agent.list" => agent_config::list(machine, outbox, from, body).await,
        "agent.delete" => agent_config::delete(machine, outbox, from, body).await,
        "agent.restore" => agent_config::restore(machine, outbox, from, body).await,
        "agent.create" => agent_config::create(machine, outbox, from, body).await,
        "agent.update" => agent_config::update(machine, outbox, from, body).await,
        "task.list" => task_message::list(machine, outbox, from, body),
        "task.message" => task_message::message(machine, outbox, from, body),
        "task.sync" => task_message::sync(machine, outbox, from, body),
        "task.stop" => task_message::stop(machine, outbox, from, body),
        "approval.answer" => task_message::approval_answer(machine, outbox, from, body),
        // An unknown type still names its Agent and Task, and hears
        // `agent.unknown` or `task.unknown` when either is missing.
        _ => {
            let _ = task_message::target(machine, outbox, from, body);
        }
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
        FromWorker::ToolOutput {
            task,
            starter,
            tool_use_id,
            tail,
            bytes,
            elapsed_ms,
        } => outbox.to_member(
            &starter,
            "tool.output",
            json!({
                "agent": agent,
                "toolUseId": tool_use_id,
                "tail": tail,
                "bytes": bytes,
                "elapsedMs": elapsed_ms,
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
        // The log requests are answered where the log is written; the worker's
        // own frames never reach this far.
        FromWorker::Ready
        | FromWorker::LlmRequest { .. }
        | FromWorker::LogAppend { .. }
        | FromWorker::LogRead { .. } => {}
    }
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
