//! The Task log, written only here (ADR 0018, 0020, 0069).
//!
//! A worker gets no file: it asks the supervisor over IPC for every read and
//! every append. The log therefore lives outside the folder the sandbox lets an
//! Agent write, and outside its view altogether — a command that was talked
//! into rewriting history cannot name the file, let alone open it.
//!
//! The old place was `<home>/agents/<id>/tasks.db`, inside the writable folder.
//! The first worker start after the update moves it, so an Agent that already
//! has a log keeps its history without the Owner doing anything.

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use veeloe_runtime_core::{
    EventLog, EventStore, FromWorker, LogAnswer, LogQuery, StoreError, TaskEvent,
};

/// `<home>/task-logs/<id>`: where one Agent's log is kept, outside
/// `<home>/agents/<id>` so no rule that lets a command write its own folder
/// reaches it.
pub fn dir(home: &Path, agent: &str) -> PathBuf {
    home.join("task-logs").join(agent)
}

/// The file itself, for the tests and for the move.
pub fn path(home: &Path, agent: &str) -> PathBuf {
    dir(home, agent).join("tasks.db")
}

pub struct TaskLogs {
    home: PathBuf,
    stores: Mutex<HashMap<String, Arc<Mutex<EventStore>>>>,
}

impl TaskLogs {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            stores: Mutex::new(HashMap::new()),
        }
    }

    /// Moves an Agent's log out of its writable folder the first time and opens
    /// it, so the worker that is about to start has a log to read. Called
    /// before the worker's process is wrapped or spawned.
    pub fn prepare(&self, agent: &str, agent_dir: &Path) -> Result<PathBuf, String> {
        let dir = dir(&self.home, agent);
        fs::create_dir_all(&dir).map_err(|error| format!("could not make {dir:?}: {error}"))?;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        let target = dir.join("tasks.db");
        if !target.exists() {
            // The old log is one file with its SQLite sidecars.
            for suffix in ["", "-wal", "-shm"] {
                let old = agent_dir.join(format!("tasks.db{suffix}"));
                if old.exists() {
                    fs::rename(&old, dir.join(format!("tasks.db{suffix}")))
                        .map_err(|error| format!("could not move {old:?}: {error}"))?;
                }
            }
        }
        self.open(agent)?;
        Ok(target)
    }

    /// One store per Agent, kept open: the supervisor is the writer, and a
    /// second connection to the same file would only add locking.
    fn open(&self, agent: &str) -> Result<Arc<Mutex<EventStore>>, String> {
        let mut stores = self.stores.lock().expect("stores");
        if let Some(store) = stores.get(agent) {
            return Ok(Arc::clone(store));
        }
        let file = path(&self.home, agent);
        let store = EventStore::open(&file).map_err(|error| format!("{error}"))?;
        let store = Arc::new(Mutex::new(store));
        stores.insert(agent.to_string(), Arc::clone(&store));
        Ok(store)
    }

    /// One event, written before the worker is told it landed: an event the
    /// worker saw is in the log even if that worker dies right after (ADR 0069).
    pub fn record(
        &self,
        agent: &str,
        task: &str,
        starter: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, String> {
        let store = self.open(agent)?;
        store
            .record(task, starter, kind, body, message_id)
            .map_err(|error: StoreError| error.to_string())
    }

    /// The read side of the same log, for a worker that may not open it.
    pub fn answer(&self, agent: &str, query: &LogQuery) -> Result<LogAnswer, String> {
        let store = self.open(agent)?;
        let answer = match query {
            LogQuery::Starter { task } => LogAnswer::Starter {
                starter: store.starter_of(task).map_err(code)?,
            },
            LogQuery::HasMessage { id } => LogAnswer::HasMessage {
                seen: store.has_message(id).map_err(code)?,
            },
            LogQuery::Events { task, after } => LogAnswer::Events {
                events: store.events(task, *after).map_err(code)?,
            },
            LogQuery::TasksStartedBy { member } => LogAnswer::TasksStartedBy {
                tasks: store.tasks_started_by(member).map_err(code)?,
            },
            LogQuery::OpenTurns => LogAnswer::OpenTurns {
                tasks: store.open_turns().map_err(code)?,
            },
        };
        Ok(answer)
    }
}

/// A read or write that failed, as the code a worker's refusal names.
fn code(error: StoreError) -> String {
    error.to_string()
}

/// The one line a Turn's end may leave in the log: identifiers and codes, and
/// never the reason's own wording when it is not a code (ADR 0052).
pub fn turn_log(agent: &str, message: &FromWorker) -> Option<(&'static str, Value)> {
    let FromWorker::Event { task, event, .. } = message else {
        return None;
    };
    if event.kind != "turn.ended" {
        return None;
    }
    let reason = event
        .body
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("ended");
    let mut fields = json!({ "agent": agent, "task": task, "reason": reason });
    if let Some(code) = event.body.get("code").and_then(Value::as_str) {
        fields["code"] = json!(code);
    }
    let level = if reason == "error" { "error" } else { "info" };
    Some((level, fields))
}

#[cfg(test)]
mod tests {
    use super::turn_log;

    fn event(kind: &str, body: serde_json::Value) -> veeloe_runtime_core::FromWorker {
        veeloe_runtime_core::FromWorker::Event {
            task: "task-1".into(),
            starter: "member-1".into(),
            event: veeloe_runtime_core::TaskEvent {
                seq: 7,
                kind: kind.into(),
                at: 1_700_000_000,
                body,
            },
        }
    }

    #[test]
    fn a_turn_end_logs_its_ids_and_codes_and_nothing_else() {
        let (level, fields) = turn_log(
            "helper",
            &event(
                "turn.ended",
                serde_json::json!({
                    "reason": "error",
                    "code": "provider.failed",
                    "text": "a Task line that must never be logged",
                    "file": "secret.txt"
                }),
            ),
        )
        .expect("a turn end is logged");
        assert_eq!(level, "error");
        assert_eq!(
            fields,
            serde_json::json!({
                "agent": "helper",
                "task": "task-1",
                "reason": "error",
                "code": "provider.failed"
            })
        );
    }

    #[test]
    fn other_worker_events_and_a_finished_turn_are_not_logged_as_errors() {
        assert!(turn_log("helper", &event("turn.started", serde_json::json!({}))).is_none());
        let (level, fields) = turn_log(
            "helper",
            &event("turn.ended", serde_json::json!({ "reason": "stop" })),
        )
        .expect("a stopped turn is logged");
        assert_eq!(level, "info");
        assert_eq!(fields["reason"], "stop");
        assert!(fields.get("code").is_none());
    }
}
