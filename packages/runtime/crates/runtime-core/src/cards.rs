//! Cards the Agent shows in a Task (ADR 0082). This first set is the two that ask
//! a Question (issue #71): `ask_choice`, one question with up to four options,
//! and `ask_form`, up to six short fields. The Runtime checks what the model sent
//! before anything is drawn; a bad call goes back to the model as an error that
//! names the field, so it can try again. A Card that passes becomes a
//! `card.shown` event with its values and a plain-text `fallback` for a
//! Controller or Channel that cannot draw it.

use serde_json::{json, Value};
use veeloe_plugin_api::ToolDefinition;

pub const ASK_CHOICE: &str = "ask_choice";
pub const ASK_FORM: &str = "ask_form";
/// The schema version a `card.shown` carries, so a Controller knows what it draws.
pub const CARD_VERSION: u32 = 1;

const CHOICES_MAX: usize = 4;
const FIELDS_MAX: usize = 6;
const TEXT_MAX: usize = 500;
const FIELD_KINDS: [&str; 4] = ["text", "number", "choice", "date"];

pub fn ask_choice() -> ToolDefinition {
    ToolDefinition {
        name: ASK_CHOICE.into(),
        description: "Asks the person who sent this message one question and waits for the answer, without ending your Turn. Give up to 4 short options; they can always type their own answer instead. Use it only when the options lead to different work and you cannot pick one yourself; otherwise choose and say what you chose. Returns their answer, or that nobody answered in time, after which you carry on yourself.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "question": { "type": "string" },
                "options": { "type": "array", "items": { "type": "string" }, "maxItems": CHOICES_MAX },
            },
            "required": ["question"],
        }),
    }
}

pub fn ask_form() -> ToolDefinition {
    ToolDefinition {
        name: ASK_FORM.into(),
        description: "Asks the person who sent this message for a few short values at once and waits, without ending your Turn: up to 6 fields, each text, number, choice (with options) or date. Never ask for a password, key or other secret here. Returns the values they filled in, or that nobody answered in time.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "question": { "type": "string" },
                "fields": {
                    "type": "array",
                    "maxItems": FIELDS_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "label": { "type": "string" },
                            "kind": { "type": "string", "enum": FIELD_KINDS },
                            "options": { "type": "array", "items": { "type": "string" } },
                        },
                        "required": ["name", "label", "kind"],
                    },
                },
            },
            "required": ["question", "fields"],
        }),
    }
}

/// A Card's values once checked, and the plain text that stands in for it.
#[derive(Debug, PartialEq)]
pub struct Checked {
    pub value: Value,
    pub fallback: String,
}

fn text(input: &Value, key: &str) -> Result<String, String> {
    let value = input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if value.is_empty() {
        return Err(format!("{key}: required"));
    }
    if value.chars().count() > TEXT_MAX {
        return Err(format!("{key}: at most {TEXT_MAX} characters"));
    }
    Ok(value.to_string())
}

fn strings(input: &Value, key: &str, max: usize) -> Result<Vec<String>, String> {
    let Some(list) = input.get(key) else {
        return Ok(Vec::new());
    };
    let list = list
        .as_array()
        .ok_or_else(|| format!("{key}: must be a list"))?;
    if list.len() > max {
        return Err(format!("{key}: at most {max}"));
    }
    list.iter()
        .enumerate()
        .map(|(i, item)| {
            let item = item.as_str().map(str::trim).unwrap_or_default();
            if item.is_empty() || item.chars().count() > TEXT_MAX {
                Err(format!("{key}[{i}]: a short text"))
            } else {
                Ok(item.to_string())
            }
        })
        .collect()
}

/// Checks what the model sent for `tool` against its schema and limits.
pub fn check(tool: &str, input: &Value) -> Result<Checked, String> {
    let question = text(input, "question")?;
    match tool {
        ASK_CHOICE => {
            let options = strings(input, "options", CHOICES_MAX)?;
            let mut fallback = question.clone();
            for (i, option) in options.iter().enumerate() {
                fallback.push_str(&format!("\n{}. {option}", i + 1));
            }
            Ok(Checked {
                value: json!({ "question": question, "options": options }),
                fallback,
            })
        }
        ASK_FORM => {
            let fields = input
                .get("fields")
                .and_then(Value::as_array)
                .ok_or("fields: required")?;
            if fields.is_empty() || fields.len() > FIELDS_MAX {
                return Err(format!("fields: 1 to {FIELDS_MAX}"));
            }
            let mut checked = Vec::new();
            let mut fallback = question.clone();
            for (i, field) in fields.iter().enumerate() {
                let at = |error: String| format!("fields[{i}].{error}");
                let name = text(field, "name").map_err(at)?;
                let label = text(field, "label").map_err(at)?;
                let kind = field.get("kind").and_then(Value::as_str).unwrap_or("");
                if !FIELD_KINDS.contains(&kind) {
                    return Err(at(format!("kind: one of {}", FIELD_KINDS.join(", "))));
                }
                let options = strings(field, "options", CHOICES_MAX * 2).map_err(at)?;
                if kind == "choice" && options.is_empty() {
                    return Err(at("options: a choice field needs them".into()));
                }
                fallback.push_str(&format!("\n- {label}"));
                let mut entry = json!({ "name": name, "label": label, "kind": kind });
                if !options.is_empty() {
                    entry["options"] = json!(options);
                }
                checked.push(entry);
            }
            Ok(Checked {
                value: json!({ "question": question, "fields": checked }),
                fallback,
            })
        }
        _ => Err(format!("there is no Card named {tool}")),
    }
}

/// What the model reads back once the Question is settled.
pub fn result(answer: Option<&Value>) -> String {
    match answer {
        Some(answer) => format!(
            "The person answered: {}",
            serde_json::to_string(answer).unwrap_or_default()
        ),
        None => {
            "Nobody answered in time. Carry on with your own best judgement and say what you chose."
                .into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_choice_needs_a_question_and_at_most_four_options() {
        let ok = check(
            ASK_CHOICE,
            &json!({ "question": "Where to deploy?", "options": ["staging", "production"] }),
        )
        .expect("checked");
        assert_eq!(ok.fallback, "Where to deploy?\n1. staging\n2. production");
        assert_eq!(
            check(ASK_CHOICE, &json!({ "options": ["a"] })).unwrap_err(),
            "question: required"
        );
        assert_eq!(
            check(
                ASK_CHOICE,
                &json!({ "question": "q", "options": ["a", "b", "c", "d", "e"] })
            )
            .unwrap_err(),
            "options: at most 4"
        );
    }

    #[test]
    fn a_form_names_the_field_that_is_wrong() {
        let fields = json!([
            { "name": "env", "label": "Where", "kind": "choice", "options": ["a"] },
            { "name": "pw", "label": "Password", "kind": "secret" },
        ]);
        assert_eq!(
            check(ASK_FORM, &json!({ "question": "q", "fields": fields })).unwrap_err(),
            "fields[1].kind: one of text, number, choice, date"
        );
        let no_options = json!([{ "name": "env", "label": "Where", "kind": "choice" }]);
        assert!(
            check(ASK_FORM, &json!({ "question": "q", "fields": no_options }))
                .unwrap_err()
                .starts_with("fields[0].options")
        );
        let seven: Vec<Value> = (0..7)
            .map(|i| json!({ "name": format!("f{i}"), "label": "x", "kind": "text" }))
            .collect();
        assert_eq!(
            check(ASK_FORM, &json!({ "question": "q", "fields": seven })).unwrap_err(),
            "fields: 1 to 6"
        );
    }
}
