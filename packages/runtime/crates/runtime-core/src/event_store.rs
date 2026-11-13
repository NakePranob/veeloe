//! The append-only Task event log (ADR 0018), over SQLite.
//!
//! The schema matches `packages/runtime-legacy/src/worker/adapters/sqlite-store.ts`
//! exactly, so a Task log written by the Bun runtime opens here unchanged.
//!
//! Only the supervisor opens the file. A worker reaches the log through
//! [`EventLog`], which it implements over IPC, so the log is not a file any
//! command or tool of an Agent can see, let alone open for writing (ADR 0069).

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS task (id TEXT PRIMARY KEY NOT NULL, starter TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS event (
  task_id TEXT NOT NULL REFERENCES task(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  message_id TEXT UNIQUE,
  PRIMARY KEY (task_id, seq)
);
";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskEvent {
    pub seq: i64,
    pub kind: String,
    pub at: i64,
    pub body: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSummary {
    pub id: String,
    pub updated: i64,
}

pub trait Clock {
    fn now(&self) -> i64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock is after 1970")
            .as_millis() as i64
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The supervisor could not write, or did not answer: the caller sees a
    /// refusal rather than an event that is not in the log.
    #[error("log: {0}")]
    Refused(String),
}

/// The log as the core needs it: the one write and the reads a Turn makes.
///
/// The supervisor owns the only implementation that writes (ADR 0020, 0069); a
/// worker gets one over IPC, and tests use the store itself ([`Mutex<EventStore>`]).
pub trait EventLog: Send + Sync {
    /// Appends one event, creating the Task's row on its first event.
    fn record(
        &self,
        task: &str,
        starter: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, StoreError>;
    fn starter_of(&self, task: &str) -> Result<Option<String>, StoreError>;
    fn has_message(&self, message_id: &str) -> Result<bool, StoreError>;
    fn events(&self, task: &str, after: i64) -> Result<Vec<TaskEvent>, StoreError>;
    fn tasks_started_by(&self, member: &str) -> Result<Vec<TaskSummary>, StoreError>;
    fn open_turns(&self) -> Result<Vec<String>, StoreError>;
}

impl<C: Clock + Send> EventLog for Mutex<EventStore<C>> {
    fn record(
        &self,
        task: &str,
        starter: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, StoreError> {
        let mut store = self.lock().expect("store");
        store.ensure_task(task, starter)?;
        store.append(task, kind, body, message_id)
    }

    fn starter_of(&self, task: &str) -> Result<Option<String>, StoreError> {
        self.lock().expect("store").starter_of(task)
    }

    fn has_message(&self, message_id: &str) -> Result<bool, StoreError> {
        self.lock().expect("store").has_message(message_id)
    }

    fn events(&self, task: &str, after: i64) -> Result<Vec<TaskEvent>, StoreError> {
        self.lock().expect("store").events(task, after)
    }

    fn tasks_started_by(&self, member: &str) -> Result<Vec<TaskSummary>, StoreError> {
        self.lock().expect("store").tasks_started_by(member)
    }

    fn open_turns(&self) -> Result<Vec<String>, StoreError> {
        self.lock().expect("store").open_turns()
    }
}

pub struct EventStore<C: Clock = SystemClock> {
    conn: Connection,
    clock: C,
}

impl EventStore<SystemClock> {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::open_with(path, SystemClock)
    }
}

impl<C: Clock> EventStore<C> {
    pub fn open_with(path: impl AsRef<Path>, clock: C) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn, clock })
    }

    pub fn create_task(&self, task: &str, starter: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO task (id, starter, created_at) VALUES (?1, ?2, ?3)",
            params![task, starter, self.clock.now()],
        )?;
        Ok(())
    }

    /// Creates the Task's row unless it is there already. The first event of a
    /// Task carries its starter, so the writer must not fail on a Task it has
    /// already seen.
    pub fn ensure_task(&self, task: &str, starter: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO task (id, starter, created_at) VALUES (?1, ?2, ?3)",
            params![task, starter, self.clock.now()],
        )?;
        Ok(())
    }

    pub fn starter_of(&self, task: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT starter FROM task WHERE id = ?1", [task], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn has_message(&self, message_id: &str) -> Result<bool, StoreError> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM event WHERE message_id = ?1",
                [message_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn append(
        &mut self,
        task: &str,
        kind: &str,
        body: &Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, StoreError> {
        let at = self.clock.now();
        let tx = self.conn.transaction()?;
        let seq: i64 = tx.query_row(
            "SELECT coalesce(max(seq), 0) + 1 FROM event WHERE task_id = ?1",
            [task],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO event (task_id, seq, kind, body, at, message_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![task, seq, kind, serde_json::to_string(body)?, at, message_id],
        )?;
        tx.commit()?;
        Ok(TaskEvent {
            seq,
            kind: kind.to_string(),
            at,
            body: body.clone(),
        })
    }

    pub fn events(&self, task: &str, after: i64) -> Result<Vec<TaskEvent>, StoreError> {
        let mut statement = self.conn.prepare(
            "SELECT seq, kind, body, at FROM event WHERE task_id = ?1 AND seq > ?2 ORDER BY seq",
        )?;
        let rows = statement.query_map(params![task, after], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        let mut events = Vec::new();
        for row in rows {
            let (seq, kind, body, at) = row?;
            events.push(TaskEvent {
                seq,
                kind,
                at,
                body: serde_json::from_str(&body)?,
            });
        }
        Ok(events)
    }

    pub fn tasks_started_by(&self, member: &str) -> Result<Vec<TaskSummary>, StoreError> {
        let mut statement = self.conn.prepare(
            "SELECT t.id, coalesce((SELECT max(at) FROM event WHERE task_id = t.id), t.created_at) AS updated
             FROM task t WHERE t.starter = ?1",
        )?;
        let rows = statement.query_map([member], |row| {
            Ok(TaskSummary {
                id: row.get(0)?,
                updated: row.get(1)?,
            })
        })?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }
        Ok(tasks)
    }

    /// The Tasks whose latest Turn boundary is a start: a Turn was running when
    /// their worker ended (ADR 0033).
    pub fn open_turns(&self) -> Result<Vec<String>, StoreError> {
        let mut statement = self.conn.prepare(
            "SELECT e.task_id FROM event e WHERE e.kind IN (?1, ?2)
             GROUP BY e.task_id HAVING
               (SELECT kind FROM event WHERE task_id = e.task_id AND kind IN (?3, ?4)
                ORDER BY seq DESC LIMIT 1) = ?5",
        )?;
        let rows = statement.query_map(
            params!["turn.started", "turn.ended", "turn.started", "turn.ended", "turn.started"],
            |row| row.get::<_, String>(0),
        )?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }
        Ok(tasks)
    }

    pub fn close(self) -> Result<(), StoreError> {
        self.conn.close().map_err(|(_, error)| error.into())
    }
}
