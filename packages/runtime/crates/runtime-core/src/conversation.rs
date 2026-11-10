use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::event_store::TaskEvent;
use crate::ports::LlmMessage;

/// What the LLM is sent, built from the log alone (ADR 0018). A Turn that never
/// ended, because its worker died, keeps the Member's words and drops the rest,
/// so no tool_use goes out without its result. The Turn running now counts as
/// ended.
pub fn conversation(events: &[TaskEvent]) -> Vec<LlmMessage> {
    // The newest compaction owns the model's view: its summary, then only the
    // events after it. The transcript itself keeps every original event.
    if let Some(index) = events.iter().rposition(|event| event.kind == "context.compacted") {
        let body = &events[index].body;
        let summary = body.get("summary").and_then(Value::as_str).unwrap_or_default();
        if !summary.is_empty() {
            let through = body.get("throughSeq").and_then(Value::as_i64).unwrap_or(0);
            let after: Vec<TaskEvent> = events
                .iter()
                .filter(|event| event.seq > through && event.kind != "context.compacted")
                .cloned()
                .collect();
            let mut messages = conversation(&after);
            messages.insert(
                0,
                LlmMessage {
                    role: "user".into(),
                    content: vec![json!({
                        "type": "text",
                        "text": format!("Summary of the earlier part of this Task:\n{summary}")
                    })],
                },
            );
            return messages;
        }
    }
    let mut ended = HashSet::new();
    let mut turn = 0i64;
    let mut turn_of = HashMap::new();

    for event in events {
        if event.kind == "turn.started" {
            turn = event.seq;
        }
        turn_of.insert(event.seq, turn);
        if event.kind == "turn.ended" {
            ended.insert(turn);
        }
    }
    ended.insert(turn);

    let mut messages = Vec::new();
    for event in events {
        if event.kind == "member.message" {
            let text = event
                .body
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            messages.push(LlmMessage {
                role: "user".into(),
                content: vec![json!({ "type": "text", "text": text })],
            });
            continue;
        }
        if !ended.contains(&turn_of.get(&event.seq).copied().unwrap_or(0)) {
            continue;
        }
        if event.kind == "llm.message" {
            messages.push(LlmMessage {
                role: "assistant".into(),
                content: content_of(&event.body),
            });
        } else if event.kind == "tool.result" {
            messages.push(LlmMessage {
                role: "user".into(),
                content: content_of(&event.body),
            });
        }
    }
    messages
}

fn content_of(body: &Value) -> Vec<Value> {
    body.get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
