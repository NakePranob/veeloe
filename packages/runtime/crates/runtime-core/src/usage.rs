//! The tokens a whole answer reports (ADR 0043), ported from
//! `packages/runtime-legacy/src/supervisor/budget/budget.ts`.

use serde_json::Value;

/// The tokens a whole answer reports, whether it is one JSON body or an SSE
/// stream (ADR 0043). None when the answer says nothing of `usage`.
pub fn usage_in(text: &str) -> Option<u64> {
    let body = text.trim();
    if body.starts_with('{') {
        let parsed: Value = serde_json::from_str(body).ok()?;
        return total(parsed.get("usage"));
    }
    let mut latest: Vec<(&'static str, u64)> = Vec::new();
    for line in body.split('\n') {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let usage = event
            .get("usage")
            .or_else(|| event.get("message").and_then(|message| message.get("usage")));
        let Some(usage) = usage else {
            continue;
        };
        for field in USAGE_FIELDS {
            if let Some(value) = counted(usage.get(field)) {
                match latest.iter_mut().find(|(name, _)| *name == field) {
                    Some(slot) => slot.1 = value,
                    None => latest.push((field, value)),
                }
            }
        }
    }
    if latest.is_empty() {
        return None;
    }
    Some(latest.into_iter().map(|(_, value)| value).sum())
}


const USAGE_FIELDS: [&str; 4] = [
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
];

/// A Provider's count cannot take tokens away: a negative one is zero.
fn counted(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.max(0.0) as u64)
}

fn total(usage: Option<&Value>) -> Option<u64> {
    let usage = usage?;
    let mut sum = 0;
    let mut seen = false;
    for field in USAGE_FIELDS {
        if let Some(value) = counted(usage.get(field)) {
            sum += value;
            seen = true;
        }
    }
    seen.then_some(sum)
}
