//! `trigger.set`, `.pause`, `.resume`, `.delete`, `.run` and `.list`: the
//! Triggers a Member signs for an Agent (issue #56). Every one answers with the
//! Agent's `trigger.listed`, so the Controller always draws what the Machine holds.

use serde_json::{json, Value};

use crate::tasks::{agent_of, Inbound, Machine, Outbox};
use crate::triggers::{start_round, MachineTime, TriggerRecord, Triggers};

/// The Triggers and the Agent this message is about, once it may touch them;
/// otherwise the error has been sent.
fn checked<'a>(
    machine: &Machine<'a>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
) -> Option<(&'a Triggers, String)> {
    let Some(triggers) = machine.triggers else {
        outbox.error(from, "trigger.unavailable");
        return None;
    };
    let agent = agent_of(body);
    match machine.registry.get(agent) {
        Ok(Some(found)) if !found.deleted() => {}
        _ => {
            outbox.error(from, "agent.unknown");
            return None;
        }
    }
    // A key that is not this Member's, or a Member without Use, sets nothing.
    let allowed = machine
        .trust
        .is_some_and(|trust| trust.uses(&from.member, from.key.as_deref()));
    if !allowed {
        outbox.error(from, "trigger.forbidden");
        return None;
    }
    Some((triggers, agent.to_string()))
}

fn listed(outbox: &dyn Outbox, from: &Inbound, triggers: &Triggers, agent: &str) {
    let held: Vec<Value> = triggers
        .for_agent(agent)
        .iter()
        .map(|record| record.listed(&MachineTime))
        .collect();
    outbox.to_member(
        &from.member,
        "trigger.listed",
        json!({ "agent": agent, "triggers": held }),
        None,
    );
}

fn now() -> u64 {
    crate::usage::now_ms() as u64
}

/// Creates or replaces one Trigger whole; its rounds start over from now.
pub(crate) fn set(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((triggers, agent)) = checked(machine, outbox, from, body) else {
        return;
    };
    let (Some(trigger), Some(key)) = (body.get("trigger"), from.key.as_deref()) else {
        return outbox.error(from, "trigger.invalid");
    };
    let text = |name: &str| {
        trigger
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let record = TriggerRecord {
        id: text("id"),
        kind: text("kind"),
        agent: agent.clone(),
        member: from.member.clone(),
        key: key.to_string(),
        text: text("text"),
        schedule: trigger.get("schedule").cloned().unwrap_or(Value::Null),
        notify: trigger
            .get("notify")
            .and_then(Value::as_str)
            .map(str::to_string),
        paused: false,
        suspended: false,
        created_at: now(),
        last_run_at: None,
        envelope: from.envelope.clone().unwrap_or(Value::Null),
    };
    if triggers.set(record).is_err() {
        return outbox.error(from, "trigger.unavailable");
    }
    listed(outbox, from, triggers, &agent);
}

/// Pauses or resumes one Trigger.
pub(crate) fn pause(
    machine: &Machine<'_>,
    outbox: &dyn Outbox,
    from: &Inbound,
    body: &Value,
    paused: bool,
) {
    let Some((triggers, agent)) = checked(machine, outbox, from, body) else {
        return;
    };
    let id = body.get("id").and_then(Value::as_str).unwrap_or_default();
    match triggers.update(&agent, id, |record| {
        record.paused = paused;
        // A resume counts from now: what was due while paused is not owed.
        if !paused {
            record.last_run_at = Some(now());
        }
    }) {
        Ok(true) => listed(outbox, from, triggers, &agent),
        Ok(false) => outbox.error(from, "trigger.unknown"),
        Err(_) => outbox.error(from, "trigger.unavailable"),
    }
}

pub(crate) fn delete(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((triggers, agent)) = checked(machine, outbox, from, body) else {
        return;
    };
    let id = body.get("id").and_then(Value::as_str).unwrap_or_default();
    match triggers.delete(&agent, id) {
        Ok(true) => listed(outbox, from, triggers, &agent),
        Ok(false) => outbox.error(from, "trigger.unknown"),
        Err(_) => outbox.error(from, "trigger.unavailable"),
    }
}

/// One round now, beside the Schedule: its next round does not move.
pub(crate) fn run(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((triggers, agent)) = checked(machine, outbox, from, body) else {
        return;
    };
    let id = body.get("id").and_then(Value::as_str).unwrap_or_default();
    let Some(record) = triggers.get(&agent, id) else {
        return outbox.error(from, "trigger.unknown");
    };
    if record.suspended {
        return outbox.error(from, "trigger.suspended");
    }
    if start_round(machine.workers, triggers, &record, now()).is_none() {
        return outbox.error(from, "agent.unavailable");
    }
    listed(outbox, from, triggers, &agent);
}

pub(crate) fn list(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some((triggers, agent)) = checked(machine, outbox, from, body) else {
        return;
    };
    listed(outbox, from, triggers, &agent);
}
