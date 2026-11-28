//! `task.list`, `task.message`, `task.sync`, `task.stop` and `approval.answer`:
//! each sent to the Agent's worker (ADR 0021).

use serde_json::{json, Value};
use veeloe_runtime_core::ToWorker;

use crate::agents::Agent;
use crate::tasks::{agent_of, Inbound, Machine, Outbox};

/// Asks every Agent's worker for the Tasks this Member started.
pub(crate) fn list(machine: &Machine<'_>, _outbox: &dyn Outbox, from: &Inbound, _body: &Value) {
    let registry = machine.registry;
    let workers = machine.workers;
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
}

/// The Agent and Task a message names, or `None` once the error is sent.
/// A type nobody handles is answered the same way, as it always was.
pub(crate) fn target(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) -> Option<(Agent, String)> {
    let registry = machine.registry;
    let Ok(Some(agent)) = registry.get(agent_of(body)) else {
        outbox.error(from, "agent.unknown");
        return None;
    };
    // An Agent in the trash has no worker, and saying so is not an outage.
    if agent.deleted() {
        outbox.error(from, "agent.unknown");
        return None;
    }
    // Every message about an Agent's Task takes Use there (ADR 0010).
    if machine
        .trust
        .is_some_and(|trust| !trust.uses(&agent.id, &from.member, from.key.as_deref()))
    {
        outbox.error(from, "agent.forbidden");
        return None;
    }
    let Some(task) = from.task.clone() else {
        outbox.error(from, "task.unknown");
        return None;
    };
    Some((agent, task))
}

/// A Member's words, with any attachments placed in the Workdir.
pub(crate) fn message(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    // An Agent that reaches past its own folder takes work from an Owner who
    // signed it, and from no one else (ADR 0087): its sandbox is the Agent's,
    // so a Member's Turn cannot run narrower than the Owner's.
    if agent.access.files != crate::agents::Level::Folder
        && !machine
            .trust
            .is_some_and(|trust| trust.is_owner(&from.member, from.key.as_deref()))
    {
        return outbox.error(from, "files.owner_only");
    }
    let registry = machine.registry;
    let workers = machine.workers;
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

/// The events after `after`.
pub(crate) fn sync(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    let workers = machine.workers;
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

/// Stops the running Turn.
pub(crate) fn stop(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    let workers = machine.workers;
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

/// The Member names the Task; the worker checks they started it.
pub(crate) fn rename(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    let Some(title) = body.get("title").and_then(Value::as_str) else {
        return outbox.error(from, "task.unknown");
    };
    let sent = machine.workers.send(
        &agent.id,
        ToWorker::Retitle {
            task,
            title: title.to_string(),
            member: from.member.clone(),
            reference: from.reference.clone(),
        },
    );
    if !sent {
        outbox.error(from, "agent.unavailable");
    }
}

/// A domain Approval goes to the proxy waiting on it; a command's to the worker.
/// A Member's answer to a Question Card (ADR 0082). The worker holds the Question,
/// and checks the answer comes from the Turn's own Member while it still waits.
pub(crate) fn card_answer(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    let (Some(id), Some(answer)) = (body.get("id").and_then(Value::as_str), body.get("answer"))
    else {
        return outbox.error(from, "card.unknown");
    };
    let sent = machine.workers.send(
        &agent.id,
        ToWorker::CardAnswer {
            task,
            id: id.to_string(),
            answer: answer.clone(),
            member: from.member.clone(),
            reference: from.reference.clone(),
        },
    );
    if !sent {
        outbox.error(from, "agent.unavailable");
    }
}

pub(crate) fn approval_answer(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) {
    // A domain Approval is answered here, not by the worker that never asked
    // it: the proxy wrote it, and its connection waits on this answer (issue
    // #44). A request the worker holds is not ours and goes on to the worker.
    if let Some(approvals) = machine.approvals {
        if approvals.answer(from, body, machine.trust, outbox) {
            return;
        }
    }
    let Some((agent, task)) = target(machine, outbox, from, body) else {
        return;
    };
    // Whoever holds Approve answers, not whoever started the Turn (ADR 0010);
    // a permanent yes grows the Allowlist, which is Manage.
    if let Some(trust) = machine.trust {
        let key = from.key.as_deref();
        if !trust.approves(&agent.id, &from.member, key)
            || (body.get("allowAlways").is_some() && !trust.manages(&agent.id, &from.member, key))
        {
            return outbox.error(from, "approval.forbidden");
        }
    }
    let registry = machine.registry;
    let workers = machine.workers;
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
        // A permanent yes belongs to a domain Approval, which the
        // supervisor answered above; a command has no such decision.
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
