use serde_json::{Map, Value};

/// Whether a known message body passes the same validation the TypeScript
/// protocol applies. `None` means this build does not know the type, which the
/// caller skips (ADR 0023).
pub fn message_is_valid(type_: &str, body: &Value) -> Option<bool> {
    let object = body.as_object();
    let valid = match type_ {
        "agent.create" => object.map(is_agent_create).unwrap_or(false),
        "agent.update" => object.map(is_agent_update).unwrap_or(false),
        "agent.delete" => object.map(is_agent_delete).unwrap_or(false),
        "agent.restore" => object.map(is_agent_restore).unwrap_or(false),
        "agent.list" => object.is_some(),
        "agent.listed" => object.map(is_agent_listed).unwrap_or(false),
        "agent.usage" => object.map(is_agent_usage).unwrap_or(false),
        "machine.status" => object.map(is_machine_status).unwrap_or(false),
        "provider.add" => object.map(is_provider_add).unwrap_or(false),
        "file.chunk" => object.map(is_file_chunk).unwrap_or(false),
        "file.get" => object.map(is_file_get).unwrap_or(false),
        "approval.answer" => object.map(is_approval_answer).unwrap_or(false),
        "task.message" => object.map(is_task_message).unwrap_or(false),
        "task.stop" => object.map(is_task_stop).unwrap_or(false),
        "task.event" => object.map(is_task_event_body).unwrap_or(false),
        "task.events" => object.map(is_task_events).unwrap_or(false),
        "task.sync" => object.map(is_task_sync).unwrap_or(false),
        "task.list" => object.is_some(),
        "task.listed" => object.map(is_task_listed).unwrap_or(false),
        "egress.set" => object.map(is_egress_set).unwrap_or(false),
        "error" => object.map(is_error).unwrap_or(false),
        "usage.list" => object.map(is_usage_list).unwrap_or(false),
        "usage.listed" => object.map(is_usage_listed).unwrap_or(false),
        "memory.get" => object.map(is_memory_get).unwrap_or(false),
        "memory.got" => object.map(is_memory_got).unwrap_or(false),
        "pairing.claim" => object.map(is_pairing_claim).unwrap_or(false),
        "pairing.done" => object.map(is_pairing_done).unwrap_or(false),
        "device.handoff" => object.map(is_device_handoff).unwrap_or(false),
        "device.linked" => object.is_some(),
        "push.register" => object.map(is_push_register).unwrap_or(false),
        "push.registered" => object.map(is_push_registered).unwrap_or(false),
        "push.unregister" => object.is_some(),
        "push.unregistered" => object.is_some(),
        _ => return None,
    };
    Some(valid)
}

fn text(value: Option<&Value>) -> Option<&str> {
    value?.as_str()
}

fn non_empty(value: Option<&Value>) -> bool {
    text(value).map(|value| !value.is_empty()).unwrap_or(false)
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

fn is_agent_id(value: &str) -> bool {
    (1..=64).contains(&chars(value))
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn is_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && chars(trimmed) <= 80
}

fn is_part(value: &str) -> bool {
    let mut bytes = value.bytes();
    match bytes.next() {
        Some(byte) if byte.is_ascii_lowercase() => {}
        _ => return false,
    }
    let rest: Vec<u8> = bytes.collect();
    rest.len() <= 31
        && rest
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|byte| byte.is_ascii_hexdigit())
}

fn is_character(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    text(object.get("color")).map(is_hex_color).unwrap_or(false)
        && text(object.get("shell")).map(is_part).unwrap_or(false)
        && text(object.get("top")).map(is_part).unwrap_or(false)
        && text(object.get("sides")).map(is_part).unwrap_or(false)
        && text(object.get("decal")).map(is_part).unwrap_or(false)
}

fn is_allowlist(value: &Value) -> bool {
    let Some(entries) = value.as_array() else {
        return false;
    };
    entries.len() <= 100
        && entries.iter().all(|entry| {
            text(Some(entry))
                .map(|entry| (1..=500).contains(&chars(entry)))
                .unwrap_or(false)
        })
}

fn is_approval_timeout(value: &Value) -> bool {
    value
        .as_i64()
        .map(|seconds| (60..=86_400).contains(&seconds))
        .unwrap_or(false)
}

fn is_budget(value: &Value) -> bool {
    value
        .as_i64()
        .map(|tokens| (1..=1_000_000_000_000).contains(&tokens))
        .unwrap_or(false)
}

fn is_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn is_non_negative_int(value: &Value) -> bool {
    value.as_i64().map(|number| number >= 0).unwrap_or(false)
}

fn is_positive_int(value: &Value) -> bool {
    value.as_i64().map(|number| number > 0).unwrap_or(false)
}

fn is_usage(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    text(object.get("day")).map(is_day).unwrap_or(false)
        && object
            .get("tokens")
            .map(is_non_negative_int)
            .unwrap_or(false)
}

fn is_agent(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !text(object.get("id")).map(is_agent_id).unwrap_or(false)
        || !text(object.get("name")).map(is_name).unwrap_or(false)
        || !non_empty(object.get("provider"))
        || !non_empty(object.get("model"))
    {
        return false;
    }
    if let Some(character) = object.get("character") {
        if !is_character(character) {
            return false;
        }
    }
    if let Some(allowlist) = object.get("allowlist") {
        if !is_allowlist(allowlist) {
            return false;
        }
    }
    if let Some(timeout) = object.get("approvalTimeoutS") {
        if !is_approval_timeout(timeout) {
            return false;
        }
    }
    if let Some(budget) = object.get("budget") {
        if !is_budget(budget) {
            return false;
        }
    }
    if let Some(usage) = object.get("usage") {
        if !is_usage(usage) {
            return false;
        }
    }
    // Each Agent's own way out (ADR 0029, issue #43). A Machine older than that
    // sends none.
    if let Some(egress) = object.get("egress") {
        if !is_egress(egress) {
            return false;
        }
    }
    true
}

fn is_agent_create(object: &Map<String, Value>) -> bool {
    if !text(object.get("id")).map(is_agent_id).unwrap_or(false)
        || !text(object.get("name")).map(is_name).unwrap_or(false)
        || !non_empty(object.get("provider"))
        || !non_empty(object.get("model"))
    {
        return false;
    }
    if let Some(character) = object.get("character") {
        if !is_character(character) {
            return false;
        }
    }
    if let Some(allowlist) = object.get("allowlist") {
        if !is_allowlist(allowlist) {
            return false;
        }
    }
    if let Some(timeout) = object.get("approvalTimeoutS") {
        if !is_approval_timeout(timeout) {
            return false;
        }
    }
    true
}

fn is_agent_update(object: &Map<String, Value>) -> bool {
    if !text(object.get("id")).map(is_agent_id).unwrap_or(false) {
        return false;
    }
    let has_change = object.contains_key("name")
        || object.contains_key("provider")
        || object.contains_key("model")
        || object.contains_key("character")
        || object.contains_key("budget")
        || object.contains_key("allowlist")
        || object.contains_key("approvalTimeoutS");
    if !has_change {
        return false;
    }
    if object.contains_key("provider") && !object.contains_key("model") {
        return false;
    }
    if let Some(name) = object.get("name") {
        if !text(Some(name)).map(is_name).unwrap_or(false) {
            return false;
        }
    }
    if let Some(provider) = object.get("provider") {
        if !non_empty(Some(provider)) {
            return false;
        }
    }
    if let Some(model) = object.get("model") {
        if !non_empty(Some(model)) {
            return false;
        }
    }
    if let Some(character) = object.get("character") {
        if !is_character(character) {
            return false;
        }
    }
    if let Some(budget) = object.get("budget") {
        if !is_budget(budget) {
            return false;
        }
    }
    if let Some(allowlist) = object.get("allowlist") {
        if !is_allowlist(allowlist) {
            return false;
        }
    }
    if let Some(timeout) = object.get("approvalTimeoutS") {
        if !is_approval_timeout(timeout) {
            return false;
        }
    }
    true
}

fn is_provider(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !non_empty(object.get("name")) {
        return false;
    }
    if let Some(models) = object.get("models") {
        let Some(models) = models.as_array() else {
            return false;
        };
        if !models.iter().all(|model| {
            model
                .as_object()
                .map(|model| {
                    non_empty(model.get("id"))
                        && model
                            .get("name")
                            .map(|name| name.as_str().is_some())
                            .unwrap_or(true)
                })
                .unwrap_or(false)
        }) {
            return false;
        }
    }
    if let Some(error) = object.get("error") {
        if !non_empty(Some(error)) {
            return false;
        }
    }
    object.contains_key("models") || object.contains_key("error")
}

fn is_agent_delete(object: &Map<String, Value>) -> bool {
    text(object.get("id")).map(is_agent_id).unwrap_or(false)
}

fn is_agent_restore(object: &Map<String, Value>) -> bool {
    text(object.get("id")).map(is_agent_id).unwrap_or(false)
}

fn is_machine_status(object: &Map<String, Value>) -> bool {
    text(object.get("version")).is_some()
        && object.get("features").and_then(Value::as_array).is_some()
        && object
            .get("diskFreeBytes")
            .and_then(Value::as_u64)
            .is_some()
        && object.get("lastError").is_some()
}

fn is_provider_add(object: &Map<String, Value>) -> bool {
    let Some(name) = text(object.get("name")) else {
        return false;
    };
    name.as_bytes()
        .first()
        .is_some_and(|first| first.is_ascii_lowercase())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && name.len() <= 32
        && text(object.get("url"))
            .and_then(|url| url::Url::parse(url).ok())
            .is_some_and(|url| url.scheme() == "http" || url.scheme() == "https")
        && non_empty(object.get("key"))
}

fn is_file_chunk(object: &Map<String, Value>) -> bool {
    text(object.get("file")).is_some_and(|file| !file.is_empty() && file.len() <= 128)
        && object.get("index").and_then(Value::as_u64).is_some()
        && object
            .get("total")
            .and_then(Value::as_u64)
            .is_some_and(|total| total > 0)
        && non_empty(object.get("data"))
}

fn is_file_get(object: &Map<String, Value>) -> bool {
    text(object.get("path")).is_some_and(|path| !path.is_empty() && path.len() <= 4_000)
        && text(object.get("hash")).is_some_and(|hash| !hash.is_empty() && hash.len() <= 128)
}

fn is_push_token(value: &str) -> bool {
    value.len() <= 256
        && value.starts_with("ExponentPushToken[")
        && value.ends_with(']')
        && value.len() > "ExponentPushToken[]".len()
}

fn is_push_register(object: &Map<String, Value>) -> bool {
    text(object.get("token")).is_some_and(is_push_token)
        && object
            .get("language")
            .map(|language| matches!(language.as_str(), Some("th" | "en")))
            .unwrap_or(true)
}

fn is_push_registered(object: &Map<String, Value>) -> bool {
    text(object.get("token")).is_some_and(is_push_token)
}

fn is_agent_listed(object: &Map<String, Value>) -> bool {
    let Some(agents) = object.get("agents").and_then(Value::as_array) else {
        return false;
    };
    if !agents.iter().all(is_agent) {
        return false;
    }
    if let Some(trash) = object.get("trash") {
        let Some(trash) = trash.as_array() else {
            return false;
        };
        if !trash.iter().all(is_agent_trash_entry) {
            return false;
        }
    }
    let Some(providers) = object.get("providers").and_then(Value::as_array) else {
        return false;
    };
    if !providers.iter().all(is_provider) {
        return false;
    }
    if let Some(egress) = object.get("egress") {
        if !is_egress(egress) {
            return false;
        }
    }
    true
}

fn is_agent_trash_entry(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    is_agent(value)
        && object
            .get("deletedAt")
            .map(is_non_negative_int)
            .unwrap_or(false)
        && object
            .get("restoreUntil")
            .map(is_non_negative_int)
            .unwrap_or(false)
}

fn is_agent_usage(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && text(object.get("day")).map(is_day).unwrap_or(false)
        && object
            .get("tokens")
            .map(is_non_negative_int)
            .unwrap_or(false)
        && object.get("budget").map(is_budget).unwrap_or(false)
}

fn is_task_event(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("seq").map(is_positive_int).unwrap_or(false)
        && non_empty(object.get("kind"))
        && object.get("at").map(is_non_negative_int).unwrap_or(false)
        && object.contains_key("body")
}

fn is_task_event_body(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && is_task_event(&Value::Object(object.clone()))
}

fn is_task_message(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && text(object.get("id"))
            .map(|id| (1..=64).contains(&chars(id)))
            .unwrap_or(false)
        && text(object.get("text"))
            .map(|text| (1..=100_000).contains(&chars(text)))
            .unwrap_or(false)
}

fn is_task_stop(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && text(object.get("id"))
            .map(|id| (1..=64).contains(&chars(id)))
            .unwrap_or(false)
}

fn is_task_sync(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && object
            .get("after")
            .map(is_non_negative_int)
            .unwrap_or(false)
}

fn is_task_events(object: &Map<String, Value>) -> bool {
    text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        && object
            .get("events")
            .and_then(Value::as_array)
            .map(|events| events.iter().all(is_task_event))
            .unwrap_or(false)
}

fn is_task_listed(object: &Map<String, Value>) -> bool {
    object
        .get("tasks")
        .and_then(Value::as_array)
        .map(|tasks| {
            tasks.iter().all(|task| {
                task.as_object()
                    .map(|task| {
                        text(task.get("id"))
                            .map(|id| (1..=64).contains(&chars(id)))
                            .unwrap_or(false)
                            && text(task.get("agent")).map(is_agent_id).unwrap_or(false)
                            && task
                                .get("updated")
                                .map(is_non_negative_int)
                                .unwrap_or(false)
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn is_egress_domain(value: &str) -> bool {
    if chars(value) > 253 {
        return false;
    }
    let value = value.strip_prefix("*.").unwrap_or(value);
    let labels: Vec<&str> = value.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let Some(last) = labels.last() else {
        return false;
    };
    if last.len() < 2 || last.len() > 63 || !last.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return false;
    }
    labels.iter().all(|label| {
        (1..=63).contains(&label.len())
            && label
                .bytes()
                .next()
                .map(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                .unwrap_or(false)
            && label
                .bytes()
                .last()
                .map(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                .unwrap_or(false)
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    })
}

fn is_egress(value: &Value) -> bool {
    value
        .as_array()
        .map(|entries| {
            entries.len() <= 100
                && entries
                    .iter()
                    .all(|entry| text(Some(entry)).map(is_egress_domain).unwrap_or(false))
        })
        .unwrap_or(false)
}

fn is_egress_set(object: &Map<String, Value>) -> bool {
    // `agent` is optional (issue #43): without it the list is every Agent's, as
    // it was before; with it, only that Agent's, and it must be a folder name.
    let agent = object
        .get("agent")
        .map(|agent| text(Some(agent)).map(is_agent_id).unwrap_or(false))
        .unwrap_or(true);
    agent && object.get("egress").map(is_egress).unwrap_or(false)
}

fn is_error_code(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    value.split('.').all(|segment| {
        let mut bytes = segment.bytes();
        matches!(bytes.next(), Some(byte) if byte.is_ascii_lowercase())
            && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    })
}

fn is_error(object: &Map<String, Value>) -> bool {
    if !text(object.get("code")).map(is_error_code).unwrap_or(false) {
        return false;
    }
    if let Some(params) = object.get("params") {
        let Some(params) = params.as_object() else {
            return false;
        };
        if !params
            .values()
            .all(|value| value.is_string() || value.is_number() || value.is_boolean())
        {
            return false;
        }
    }
    if let Some(reference) = object.get("ref") {
        if !non_empty(Some(reference)) {
            return false;
        }
    }
    true
}

fn is_usage_agent(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !text(object.get("agent")).map(is_agent_id).unwrap_or(false) {
        return false;
    }
    let Some(days) = object.get("days").and_then(Value::as_array) else {
        return false;
    };
    if days.len() > 90
        || !days.iter().all(|day| {
            day.as_object()
                .map(|day| {
                    text(day.get("day")).map(is_day).unwrap_or(false)
                        && day.get("tokens").map(is_non_negative_int).unwrap_or(false)
                })
                .unwrap_or(false)
        })
    {
        return false;
    }
    let Some(tasks) = object.get("tasks").and_then(Value::as_array) else {
        return false;
    };
    if tasks.len() > 20
        || !tasks.iter().all(|task| {
            task.as_object()
                .map(|task| {
                    text(task.get("task"))
                        .map(|id| (1..=64).contains(&chars(id)))
                        .unwrap_or(false)
                        && task.get("tokens").map(is_non_negative_int).unwrap_or(false)
                })
                .unwrap_or(false)
        })
    {
        return false;
    }
    let Some(sources) = object.get("sources").and_then(Value::as_array) else {
        return false;
    };
    sources.iter().all(|source| {
        source
            .as_object()
            .map(|source| {
                text(source.get("source"))
                    .map(|source| {
                        let mut bytes = source.bytes();
                        matches!(bytes.next(), Some(byte) if byte.is_ascii_lowercase())
                            && bytes.all(|byte| {
                                byte.is_ascii_lowercase()
                                    || byte.is_ascii_digit()
                                    || byte == b'_'
                                    || byte == b'-'
                            })
                    })
                    .unwrap_or(false)
                    && source
                        .get("tokens")
                        .map(is_non_negative_int)
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    })
}

fn is_usage_list(object: &Map<String, Value>) -> bool {
    text(object.get("request"))
        .map(|request| (1..=64).contains(&chars(request)))
        .unwrap_or(false)
        && object
            .get("days")
            .map(|days| days.as_i64().is_some())
            .unwrap_or(false)
        && object
            .get("agent")
            .map(|agent| text(Some(agent)).map(is_agent_id).unwrap_or(false))
            .unwrap_or(true)
}

fn is_usage_listed(object: &Map<String, Value>) -> bool {
    if !text(object.get("request"))
        .map(|request| (1..=64).contains(&chars(request)))
        .unwrap_or(false)
    {
        return false;
    }
    let Some(from) = text(object.get("from")) else {
        return false;
    };
    let Some(to) = text(object.get("to")) else {
        return false;
    };
    if !is_day(from) || !is_day(to) || from > to {
        return false;
    }
    object
        .get("agents")
        .and_then(Value::as_array)
        .map(|agents| agents.iter().all(is_usage_agent))
        .unwrap_or(false)
}

/// The cap plus the notice `runtime-core` appends when the file is longer, so a Memory answer
/// never grows with the file (`agent-memory-page`). Counted in Unicode scalars; the TypeScript
/// bound counts UTF-16 units, so the two differ only for astral-plane characters.
const MEMORY_TEXT_MAX: usize = 4_200;

fn is_memory_get(object: &Map<String, Value>) -> bool {
    text(object.get("request"))
        .map(|request| (1..=64).contains(&chars(request)))
        .unwrap_or(false)
        && object
            .get("agent")
            .and_then(|agent| text(Some(agent)))
            .map(is_agent_id)
            .unwrap_or(false)
}

fn is_memory_got(object: &Map<String, Value>) -> bool {
    let request_ok = text(object.get("request"))
        .map(|request| (1..=64).contains(&chars(request)))
        .unwrap_or(false);
    let agent_ok = object
        .get("agent")
        .and_then(|agent| text(Some(agent)))
        .map(is_agent_id)
        .unwrap_or(false);
    let Some(exists) = object.get("exists").and_then(Value::as_bool) else {
        return false;
    };
    let Some(count) = object.get("chars").and_then(Value::as_i64) else {
        return false;
    };
    let Some(body) = text(object.get("text")) else {
        return false;
    };
    // A missing file has no text and no characters; an empty file is `exists` with zero.
    request_ok
        && agent_ok
        && count >= 0
        && chars(body) <= MEMORY_TEXT_MAX
        && (exists || (count == 0 && body.is_empty()))
}

fn is_pairing_claim(object: &Map<String, Value>) -> bool {
    if !non_empty(object.get("member")) || !non_empty(object.get("proof")) {
        return false;
    }
    if let Some(keys) = object.get("keys") {
        let Some(keys) = keys.as_array() else {
            return false;
        };
        if keys.len() > 100
            || !keys.iter().all(|key| {
                text(Some(key))
                    .map(|key| (1..=64).contains(&chars(key)))
                    .unwrap_or(false)
            })
        {
            return false;
        }
    }
    if let Some(workspace) = object.get("workspace") {
        if !non_empty(Some(workspace)) {
            return false;
        }
    }
    true
}

fn is_pairing_done(object: &Map<String, Value>) -> bool {
    text(object.get("name"))
        .map(|name| (1..=255).contains(&chars(name)))
        .unwrap_or(false)
}

fn is_device_handoff(object: &Map<String, Value>) -> bool {
    text(object.get("data"))
        .map(|data| (1..=100_000).contains(&chars(data)))
        .unwrap_or(false)
        && non_empty(object.get("proof"))
}

fn is_approval_answer(object: &Map<String, Value>) -> bool {
    if !text(object.get("agent")).map(is_agent_id).unwrap_or(false)
        || !text(object.get("request"))
            .map(|request| (1..=64).contains(&chars(request)))
            .unwrap_or(false)
    {
        return false;
    }
    let decision = text(object.get("decision"));
    if !matches!(decision, Some("approve" | "deny" | "redirect")) {
        return false;
    }
    if let Some(message) = object.get("message") {
        if !text(Some(message))
            .map(|message| (1..=10_000).contains(&chars(message)))
            .unwrap_or(false)
        {
            return false;
        }
    }
    if let Some(allow_always) = object.get("allowAlways") {
        let valid_entry = |entry: &Value| {
            text(Some(entry))
                .map(|entry| (1..=500).contains(&chars(entry)))
                .unwrap_or(false)
        };
        if let Some(entries) = allow_always.as_array() {
            if entries.is_empty() || entries.len() > 20 || !entries.iter().all(valid_entry) {
                return false;
            }
        } else if !valid_entry(allow_always) {
            return false;
        }
    }
    true
}
