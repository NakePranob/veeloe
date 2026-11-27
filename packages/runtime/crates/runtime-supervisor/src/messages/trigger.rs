//! `trigger.set`, `.pause`, `.resume`, `.delete`, `.run` and `.list`: the
//! Triggers a Member signs for an Agent (issue #56). Every one answers with the
//! Agent's `trigger.listed`, so the Controller always draws what the Machine holds.

use serde_json::Value;

use crate::tasks::{agent_of, Inbound, Machine, Outbox};
use crate::triggers::{start_round, TriggerRecord, Triggers};

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
    outbox.to_member(
        &from.member,
        "trigger.listed",
        triggers.listed_body(agent),
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
    let allow: Vec<String> = trigger
        .get("allow")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    // A scope is an Approval given ahead of time: it takes Approve (ADR 0079).
    let approves = machine
        .trust
        .is_some_and(|trust| trust.approves(&from.member, Some(key)));
    if !allow.is_empty() && !approves {
        return outbox.error(from, "trigger.forbidden");
    }
    let mut record = TriggerRecord {
        id: text("id"),
        kind: text("kind"),
        agent: agent.clone(),
        member: from.member.clone(),
        key: key.to_string(),
        text: text("text"),
        schedule: trigger.get("schedule").cloned().unwrap_or(Value::Null),
        idle: trigger.get("idle").cloned(),
        progress: Default::default(),
        notify: trigger
            .get("notify")
            .and_then(Value::as_str)
            .map(str::to_string),
        paused: false,
        suspended: false,
        created_at: now(),
        last_run_at: None,
        allow,
        title: None,
        last_skip: None,
        envelope: from.envelope.clone().unwrap_or(Value::Null),
    };
    // The same times again is an edit of what it says or may do: its rounds stay.
    if let Some(held) = triggers
        .get(&agent, &record.id)
        .filter(|held| held.schedule == record.schedule)
    {
        record.created_at = held.created_at;
        record.last_run_at = held.last_run_at;
        record.last_skip = held.last_skip;
        record.paused = held.paused;
    }
    // An Agent has one Idle Work list: a new one takes the old one's place, and
    // each piece still on it keeps where it stood (ADR 0056).
    if record.kind == "idle" {
        if let Some(old) = triggers.idle_of(&agent) {
            let ids: Vec<String> = record
                .idle
                .as_ref()
                .and_then(crate::idle::IdleList::parse)
                .map(|list| list.items.into_iter().map(|item| item.id).collect())
                .unwrap_or_default();
            record.progress = old
                .progress
                .into_iter()
                .filter(|(item, _)| ids.contains(item))
                .collect();
            if old.id != record.id {
                let _ = triggers.delete(&agent, &old.id);
            } else {
                record.created_at = old.created_at;
                record.last_run_at = old.last_run_at;
                record.paused = old.paused;
            }
        }
        // The Member has read the draft: what they signed replaces it.
        let _ = triggers.clear_draft(&agent);
    }
    // The same words keep their name; new words are named again by the Agent's model.
    let held_title = triggers
        .get(&agent, &record.id)
        .filter(|held| held.text == record.text)
        .and_then(|held| held.title);
    let name_it = held_title.is_none();
    record.title = held_title;
    let (id, text, kind) = (record.id.clone(), record.text.clone(), record.kind.clone());
    if triggers.set(record).is_err() {
        return outbox.error(from, "trigger.unavailable");
    }
    listed(outbox, from, triggers, &agent);
    if name_it {
        // Counted as the Trigger's own tokens; with no worker running it stays unnamed.
        triggers.started(&format!("trigger:{id}"), &kind);
        machine.workers.send(
            &agent,
            veeloe_runtime_core::ToWorker::TitleTrigger { id, text },
        );
    }
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
    // Other Tasks running do not hold a round back (ADR 0080); only this
    // Trigger's own round still running does.
    if machine
        .approvals
        .is_some_and(|approvals| approvals.round_running(&agent, id))
    {
        return outbox.error(from, "agent.busy");
    }
    // Whoever pressed it is there to answer: this round asks as any Turn does.
    let approves = machine
        .trust
        .is_some_and(|trust| trust.approves(&record.member, Some(&record.key)));
    // An Idle Work list's run now is its next piece, with its time limit.
    let started = if record.kind == "idle" {
        crate::triggers::start_piece(machine.workers, triggers, &record, now(), true, approves)
    } else {
        start_round(machine.workers, triggers, &record, now(), true, approves)
    };
    if started.is_none() {
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
