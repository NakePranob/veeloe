//! The `memory` tool: the one place an Agent writes `MEMORY.md` or a day's note.
//!
//! ADR 0036 keeps Memory in a plain file the Agent can also edit with the file
//! tools, but leaving the path to the model produced a `memory/` folder nobody
//! reads. This tool owns the location, the cap and the atomic write; the model
//! owns the words.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRunner};
use veeloe_runtime_core::memory::{
    append_daily_note, write_memory, MemoryWriteError, Mode, MEMORY_LIMIT,
};

const DESCRIPTION: &str = "Records something in your Memory. scope \"long\" (default) appends to MEMORY.md at the root of your working folder, which is pinned into every new Turn and capped at 4,000 characters; scope \"today\" appends to memory/<today>.md for notes that are not needed by every Task. mode \"replace\" rewrites MEMORY.md whole. Keep MEMORY.md short: agreements, stable preferences, and things already told to the owner.";

pub struct MemoryTool {
    workdir: PathBuf,
    /// `YYYY-MM-DD` in the Machine's own time; a test can pin it.
    today: Arc<dyn Fn() -> String + Send + Sync>,
}

impl MemoryTool {
    pub fn new(workdir: impl AsRef<Path>) -> Self {
        Self::with_today(workdir, today_local)
    }

    pub fn with_today(
        workdir: impl AsRef<Path>,
        today: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            workdir: workdir.as_ref().to_path_buf(),
            today: Arc::new(today),
        }
    }
}

/// The Machine's local date, the same clock the Budget day comes from (ADR 0043).
fn today_local() -> String {
    // SAFETY: `time` and `localtime_r` write only into the values given here.
    let seconds = unsafe { libc::time(std::ptr::null_mut()) };
    let mut parts: libc::tm = unsafe { std::mem::zeroed() };
    let filled = unsafe { libc::localtime_r(&seconds, &mut parts) };
    if filled.is_null() {
        // Falling back to UTC date is still a valid file name, never an empty one.
        let days = seconds / 86_400;
        return day_of(days);
    }
    format!(
        "{:04}-{:02}-{:02}",
        parts.tm_year + 1900,
        parts.tm_mon + 1,
        parts.tm_mday
    )
}

/// A UTC `YYYY-MM-DD` for the fallback above; days since the epoch, civil time.
fn day_of(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}")
}

#[async_trait]
impl ToolRunner for MemoryTool {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "memory".into(),
            description: DESCRIPTION.into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "The Markdown to record. Only new text: appended, not a copy of the file." },
                    "mode": { "type": "string", "enum": ["append", "replace"], "description": "append (default) adds to the end; replace rewrites MEMORY.md." },
                    "scope": { "type": "string", "enum": ["long", "today"], "description": "long (default) is MEMORY.md; today is memory/<today>.md." },
                },
                "required": ["text"],
            }),
        }]
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        if name != "memory" {
            return Err(ToolError::Unknown(name.into()));
        }
        let object = input.as_object().cloned().unwrap_or_default();
        let text = object
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::Failed("memory.bad: text is required".into()))?;
        let scope = object.get("scope").and_then(Value::as_str).unwrap_or("long");
        let mode = match object.get("mode").and_then(Value::as_str).unwrap_or("append") {
            "append" => Mode::Append,
            "replace" => Mode::Replace,
            other => {
                return Err(ToolError::Failed(format!(
                    "memory.bad: mode is append or replace, not {other}"
                )))
            }
        };
        if scope == "today" && mode == Mode::Replace {
            return Err(ToolError::Failed(
                "memory.bad: mode replace applies only to scope long".into(),
            ));
        }
        let today = (self.today)();
        let written = match scope {
            "long" => write_memory(&self.workdir, text, mode),
            "today" => append_daily_note(&self.workdir, &today, text),
            other => Err(MemoryWriteError::Bad(format!(
                "scope is long or today, not {other}"
            ))),
        }
        .map_err(|error| ToolError::Failed(error.to_string()))?;
        Ok(match scope {
            "today" => format!("Saved to memory/{today}.md ({written} characters)."),
            _ if mode == Mode::Replace => {
                format!("MEMORY.md replaced ({written} of {MEMORY_LIMIT} characters).")
            }
            _ => format!("Saved to MEMORY.md ({written} of {MEMORY_LIMIT} characters)."),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn tool(dir: &Path) -> MemoryTool {
        MemoryTool::with_today(dir, || "2026-11-12".to_string())
    }

    #[tokio::test]
    async fn an_append_lands_in_memory_and_reports_the_cap() {
        let dir = tempdir().expect("dir");
        let tool = tool(dir.path());
        let answer = tool
            .run(
                "memory",
                &json!({ "text": "owner likes tea" }),
                &Cancel::new(),
            )
            .await
            .expect("run");
        assert_eq!(answer, "Saved to MEMORY.md (15 of 4000 characters).");
        assert_eq!(
            fs::read_to_string(dir.path().join("MEMORY.md")).expect("read"),
            "owner likes tea"
        );
    }

    #[tokio::test]
    async fn a_write_over_the_cap_is_refused_and_says_why() {
        let dir = tempdir().expect("dir");
        let tool = tool(dir.path());
        let error = tool
            .run(
                "memory",
                &json!({ "text": "a".repeat(MEMORY_LIMIT + 1) }),
                &Cancel::new(),
            )
            .await
            .expect_err("too long");
        assert!(error.to_string().starts_with("memory.too_long"), "{error}");
        assert!(!dir.path().join("MEMORY.md").exists());
    }

    #[tokio::test]
    async fn today_writes_its_own_file_and_a_replace_rewrites_memory() {
        let dir = tempdir().expect("dir");
        let tool = tool(dir.path());
        let answer = tool
            .run(
                "memory",
                &json!({ "text": "note", "scope": "today" }),
                &Cancel::new(),
            )
            .await
            .expect("run");
        assert_eq!(answer, "Saved to memory/2026-11-12.md (4 characters).");
        assert_eq!(
            fs::read_to_string(dir.path().join("memory/2026-11-12.md")).expect("read"),
            "note"
        );
        tool.run("memory", &json!({ "text": "A" }), &Cancel::new())
            .await
            .expect("run");
        tool.run(
            "memory",
            &json!({ "text": "B", "mode": "replace" }),
            &Cancel::new(),
        )
        .await
        .expect("run");
        assert_eq!(
            fs::read_to_string(dir.path().join("MEMORY.md")).expect("read"),
            "B"
        );
    }

    #[test]
    fn the_machine_day_always_looks_like_a_day() {
        let today = today_local();
        assert_eq!(today.len(), 10, "{today}");
        assert_eq!(today.as_bytes()[4], b'-', "{today}");
        assert_eq!(today.as_bytes()[7], b'-', "{today}");
        for (index, byte) in today.bytes().enumerate() {
            if index != 4 && index != 7 {
                assert!(byte.is_ascii_digit(), "{today}");
            }
        }
        let dir = tempdir().expect("dir");
        append_daily_note(dir.path(), &today, "x").expect("a real day passes the validator");
    }

    #[tokio::test]
    async fn replace_is_only_for_the_long_memory() {
        let dir = tempdir().expect("dir");
        let tool = tool(dir.path());
        let error = tool
            .run(
                "memory",
                &json!({ "text": "x", "scope": "today", "mode": "replace" }),
                &Cancel::new(),
            )
            .await
            .expect_err("refused");
        assert!(error.to_string().contains("mode replace"), "{error}");
        assert!(!dir.path().join("memory").exists());
    }

    #[tokio::test]
    async fn a_missing_text_and_an_unknown_scope_are_errors() {
        let dir = tempdir().expect("dir");
        let tool = tool(dir.path());
        assert!(tool
            .run("memory", &json!({}), &Cancel::new())
            .await
            .is_err());
        assert!(tool
            .run("memory", &json!({ "text": "x", "scope": "week" }), &Cancel::new())
            .await
            .is_err());
    }
}
