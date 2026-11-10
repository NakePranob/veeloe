//! Token usage and the daily Budget, ported from
//! `packages/runtime-legacy/src/supervisor/{usage/store,budget/budget}.ts`.
//!
//! One row per (Agent, Budget day, source, Task) in the supervisor's own SQLite
//! file (ADR 0014, 0066). The same rows are what today's Budget is enforced
//! against, so there is never a second tally.

use std::path::Path;
use std::sync::Mutex;
use std::os::unix::fs::PermissionsExt;

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use crate::agents::Agent;
use crate::trust::TrustError;

/// The tokens an Agent gets when no one set a Budget (ADR 0043).
pub const DEFAULT_BUDGET: u64 = 10_000_000;

/// When an Agent's Budget day turns over (ADR 0043): 04:00 in the Machine's own time.
const DAY_STARTS_AT_MS: i64 = 4 * 60 * 60 * 1000;

#[derive(Debug, thiserror::Error)]
pub enum UsageError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    File(String),
}

impl From<TrustError> for UsageError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// The day a moment falls in, named the way the usage store keys a day. The
/// Machine's own offset, because a Budget day is the owner's day.
pub fn budget_day(now_ms: i64) -> String {
    budget_day_with_offset(now_ms, local_offset_seconds(now_ms))
}

/// The same rule with the offset given, so a test can hold it still.
pub fn budget_day_with_offset(now_ms: i64, offset_seconds: i64) -> String {
    let local = now_ms - DAY_STARTS_AT_MS + offset_seconds * 1_000;
    let days = local.div_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// A date-only day, shifted by whole calendar days (ADR 0043, 0066).
pub fn shift_day(day: &str, days: i64) -> String {
    let mut parts = day.split('-').filter_map(|part| part.parse::<i64>().ok());
    let (Some(year), Some(month), Some(date)) = (parts.next(), parts.next(), parts.next()) else {
        return day.to_string();
    };
    let days = days_from_civil(year, month as u32, date as u32) + days;
    let (year, month, date) = civil_from_days(days);
    format!("{year:04}-{month:02}-{date:02}")
}

fn days_from_civil(year: i64, month: u32, date: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) as i64 + 2) / 5 + date as i64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The Machine's offset from UTC at that moment, in seconds.
fn local_offset_seconds(now_ms: i64) -> i64 {
    let seconds = (now_ms / 1_000) as libc::time_t;
    let mut local: libc::tm = unsafe { std::mem::zeroed() };
    let converted = unsafe { libc::localtime_r(&seconds, &mut local) };
    if converted.is_null() {
        return 0;
    }
    local.tm_gmtoff
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Token usage history, one row per (Agent, day, source, Task).
pub struct UsageStore {
    conn: Mutex<Connection>,
}

/// One Agent's range, as `usage.listed` wants it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageRangeAgent {
    pub agent: String,
    pub days: Vec<UsageDay>,
    /// At most 20, the biggest first. Tokens not tied to a Task are in the days,
    /// not here.
    pub tasks: Vec<UsageTask>,
    pub sources: Vec<UsageSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageDay {
    pub day: String,
    pub tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageTask {
    pub task: String,
    pub tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageSource {
    pub source: String,
    pub tokens: u64,
}

impl UsageStore {
    pub fn open(path: &Path) -> Result<Self, UsageError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS usage (
               agent TEXT NOT NULL,
               day TEXT NOT NULL,
               source TEXT NOT NULL,
               task TEXT NOT NULL,
               tokens INTEGER NOT NULL,
               PRIMARY KEY (agent, day, source, task)
             );
             CREATE INDEX IF NOT EXISTS usage_by_day ON usage (day);",
        )?;
        // The tally is the owner's alone, and the folder is already 0700.
        let _ = std::fs::set_permissions(
            path,
            std::fs::Permissions::from_mode(0o600),
        );
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.import_legacy(path)?;
        Ok(store)
    }

    /// The tally `daily-budget` kept in `usage.json`, brought in once and
    /// renamed so it is never read again. A broken file stops the supervisor
    /// instead of losing the morning's tokens without a word (ADR 0014).
    fn import_legacy(&self, db: &Path) -> Result<(), UsageError> {
        let Some(dir) = db.parent() else {
            return Ok(());
        };
        let legacy = dir.join("usage.json");
        let text = match std::fs::read_to_string(&legacy) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(UsageError::File(error.to_string())),
        };
        let value: Value = serde_json::from_str(&text).map_err(|error| {
            UsageError::File(format!("cannot read {}: {error}", legacy.display()))
        })?;
        let Some(entries) = value.as_object() else {
            return Err(UsageError::File(format!(
                "cannot read {}: expected a set of tallies",
                legacy.display()
            )));
        };
        let conn = self.conn.lock().expect("usage");
        for (agent, tally) in entries {
            let day = tally.get("day").and_then(Value::as_str).unwrap_or_default();
            let tokens = tally.get("tokens").and_then(Value::as_u64).unwrap_or(0);
            if day.is_empty() || tokens == 0 {
                continue;
            }
            conn.execute(
                "INSERT INTO usage (agent, day, source, task, tokens) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (agent, day, source, task) DO UPDATE SET tokens = tokens + ?5",
                params![agent, day, "task", "", tokens as i64],
            )?;
        }
        drop(conn);
        std::fs::rename(&legacy, dir.join("usage.json.migrated"))
            .map_err(|error| UsageError::File(error.to_string()))?;
        Ok(())
    }

    pub fn add(
        &self,
        agent: &str,
        day: &str,
        source: &str,
        task: &str,
        tokens: u64,
    ) -> Result<(), UsageError> {
        let conn = self.conn.lock().expect("usage");
        conn.execute(
            "INSERT INTO usage (agent, day, source, task, tokens) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (agent, day, source, task) DO UPDATE SET tokens = tokens + ?5",
            params![agent, day, source, task, tokens as i64],
        )?;
        Ok(())
    }

    pub fn total(&self, agent: &str, day: &str) -> Result<u64, UsageError> {
        let conn = self.conn.lock().expect("usage");
        let total: i64 = conn.query_row(
            "SELECT coalesce(sum(tokens), 0) FROM usage WHERE agent = ?1 AND day = ?2",
            params![agent, day],
            |row| row.get(0),
        )?;
        Ok(total.max(0) as u64)
    }

    /// Drops days older than `before`, so the tally stays the last 30 days.
    pub fn prune(&self, before: &str) -> Result<(), UsageError> {
        let conn = self.conn.lock().expect("usage");
        conn.execute("DELETE FROM usage WHERE day < ?1", params![before])?;
        Ok(())
    }

    /// Every day this Agent has counted tokens on, oldest first.
    pub fn days(&self, agent: &str) -> Result<Vec<(String, u64)>, UsageError> {
        let conn = self.conn.lock().expect("usage");
        let mut statement = conn.prepare(
            "SELECT day, sum(tokens) FROM usage WHERE agent = ?1 GROUP BY day ORDER BY day",
        )?;
        let rows = statement.query_map([agent], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut days = Vec::new();
        for row in rows {
            let (day, tokens) = row?;
            days.push((day, tokens.max(0) as u64));
        }
        Ok(days)
    }

    /// One range, per Agent: the days it has in the range, its biggest Tasks
    /// (at most 20) and its sources. An Agent with no day in the range is left
    /// out rather than shown as a row of zeroes.
    pub fn range(
        &self,
        agents: &[String],
        from: &str,
        to: &str,
    ) -> Result<Vec<UsageRangeAgent>, UsageError> {
        let conn = self.conn.lock().expect("usage");
        let mut out = Vec::new();
        for agent in agents {
            let mut statement = conn.prepare(
                "SELECT day, sum(tokens) FROM usage
                 WHERE agent = ?1 AND day >= ?2 AND day <= ?3
                 GROUP BY day ORDER BY day",
            )?;
            let days: Vec<UsageDay> = statement
                .query_map(params![agent, from, to], |row| {
                    Ok(UsageDay {
                        day: row.get(0)?,
                        tokens: row.get::<_, i64>(1)?.max(0) as u64,
                    })
                })?
                .collect::<Result<_, _>>()?;
            if days.is_empty() {
                continue;
            }
            let mut statement = conn.prepare(
                "SELECT task, sum(tokens) FROM usage
                 WHERE agent = ?1 AND day >= ?2 AND day <= ?3 AND task <> ''
                 GROUP BY task ORDER BY sum(tokens) DESC, task LIMIT 20",
            )?;
            let tasks: Vec<UsageTask> = statement
                .query_map(params![agent, from, to], |row| {
                    Ok(UsageTask {
                        task: row.get(0)?,
                        tokens: row.get::<_, i64>(1)?.max(0) as u64,
                    })
                })?
                .collect::<Result<_, _>>()?;
            let mut statement = conn.prepare(
                "SELECT source, sum(tokens) FROM usage
                 WHERE agent = ?1 AND day >= ?2 AND day <= ?3
                 GROUP BY source ORDER BY sum(tokens) DESC",
            )?;
            let sources: Vec<UsageSource> = statement
                .query_map(params![agent, from, to], |row| {
                    Ok(UsageSource {
                        source: row.get(0)?,
                        tokens: row.get::<_, i64>(1)?.max(0) as u64,
                    })
                })?
                .collect::<Result<_, _>>()?;
            out.push(UsageRangeAgent {
                agent: agent.clone(),
                days,
                tasks,
                sources,
            });
        }
        Ok(out)
    }
}

/// What one Agent may spend today, and what it already did.
pub struct Budgets {
    store: UsageStore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage {
    pub day: String,
    pub tokens: u64,
}

impl Budgets {
    pub fn new(store: UsageStore) -> Self {
        Self { store }
    }

    pub fn limit_of(agent: &Agent) -> u64 {
        agent.budget.unwrap_or(DEFAULT_BUDGET)
    }

    /// Today's tally. Another day's reading counts as zero.
    pub fn usage_of(&self, agent: &Agent, now_ms: i64) -> Result<Usage, UsageError> {
        let day = budget_day(now_ms);
        let tokens = self.store.total(&agent.id, &day)?;
        Ok(Usage { day, tokens })
    }

    /// Records one answer, with the Task it belonged to (empty when the request
    /// named none).
    pub fn add(
        &self,
        agent: &Agent,
        now_ms: i64,
        task: &str,
        tokens: u64,
    ) -> Result<Usage, UsageError> {
        let usage = self.usage_of(agent, now_ms)?;
        self.store.add(&agent.id, &usage.day, "task", task, tokens)?;
        // The oldest day leaves when a new one is written (ADR 0043).
        self.store.prune(&shift_day(&usage.day, -29))?;
        self.usage_of(agent, now_ms)
    }

    /// True when today's tokens have reached the Agent's Budget.
    pub fn exhausted(&self, agent: &Agent, now_ms: i64) -> Result<bool, UsageError> {
        Ok(self.usage_of(agent, now_ms)?.tokens >= Self::limit_of(agent))
    }

    /// The usage history a `usage.list` answers with.
    pub fn range(
        &self,
        agents: &[String],
        from: &str,
        to: &str,
    ) -> Result<Vec<UsageRangeAgent>, UsageError> {
        self.store.range(agents, from, to)
    }
}

/// Now, as the tally and the Budget day read it.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}
