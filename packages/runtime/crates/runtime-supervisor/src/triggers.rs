//! Triggers a Member signed for an Agent to start on its own (ADR 0027, 0067,
//! issue #56): kept by the supervisor, outside every sandbox, with the whole
//! signed envelope so a round can always be traced to who asked for it.
//!
//! Only Schedule exists yet. When a round is due is worked out here from the
//! Machine's own clock; whether it may run (busy, Budget, trash, a revoked key)
//! is [`decide`], so the loop in `main.rs` only acts on the answer.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

/// One Trigger as this Machine keeps it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRecord {
    pub id: String,
    pub kind: String,
    pub agent: String,
    pub member: String,
    /// The base64url Controller key that signed it.
    pub key: String,
    pub text: String,
    /// A Schedule's times; null for another kind.
    #[serde(default)]
    pub schedule: Value,
    /// An Idle Work list as signed (ADR 0056); absent for another kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle: Option<Value>,
    /// Where each piece of an Idle Work list stands, by piece id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub progress: BTreeMap<String, crate::idle::Progress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<String>,
    #[serde(default)]
    pub paused: bool,
    /// Rounds in a row that ended in an error (ADR 0083); a done or quiet round clears it.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub failed_rounds: u32,
    /// Why it is paused when the Machine paused it, not a Member: `failures` (ADR 0083).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_for: Option<String>,
    /// What counts as done, as signed (ADR 0085); a Schedule without one runs as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    /// The latest progress note a round left (`goal_note`), at most 2000 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Why a round said the goal is met; it is paused for `goal` until resumed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub met: Option<String>,
    /// Its key was revoked or its Member lost Use: it never runs again.
    #[serde(default)]
    pub suspended: bool,
    /// Unix ms; an every-N Schedule counts from here before its first round.
    pub created_at: u64,
    /// Unix ms the last round was due, run or skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<u64>,
    /// A short name the Agent's model gave it from its words; absent until it answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// What a round nobody watches may do beyond the Agent's Allowlist (ADR 0079).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
    /// The last round that came due and did not start: when, and `busy` or `budget`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_skip: Option<LastSkip>,
    /// The signed envelope as it arrived.
    pub envelope: Value,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// A Schedule pauses itself after this many rounds in a row end in an error (ADR 0083).
pub const FAILED_ROUNDS_TO_PAUSE: u32 = 3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LastSkip {
    pub at: u64,
    pub why: String,
}

impl LastSkip {
    /// [`decide`]'s reason, in the words `trigger.listed` uses.
    pub fn new(at: u64, why: &str) -> Self {
        let why = if why == "busy" { "busy" } else { "budget" };
        Self {
            at,
            why: why.to_string(),
        }
    }
}

impl TriggerRecord {
    /// What `trigger.listed` says of it.
    pub fn listed(&self, local: &dyn LocalTime) -> Value {
        let mut value = json!({
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "member": self.member,
            "paused": self.paused,
            "suspended": self.suspended,
        });
        if !self.schedule.is_null() {
            value["schedule"] = self.schedule.clone();
        }
        if let Some(idle) = &self.idle {
            value["idle"] = idle.clone();
            if let Some(list) = crate::idle::IdleList::parse(idle) {
                value["progress"] = json!(list.listed_progress(&self.progress));
            }
        }
        if let Some(notify) = &self.notify {
            value["notify"] = json!(notify);
        }
        if let Some(last) = self.last_run_at {
            value["lastRunAt"] = json!(last);
        }
        value["allow"] = json!(self.allow);
        if let Some(title) = &self.title {
            value["title"] = json!(title);
        }
        if let Some(skip) = &self.last_skip {
            value["lastSkip"] = json!({ "at": skip.at, "why": skip.why });
        }
        if self.failed_rounds > 0 {
            value["failedRounds"] = json!(self.failed_rounds);
        }
        if let Some(why) = &self.paused_for {
            value["pausedFor"] = json!(why);
        }
        for (name, field) in [
            ("goal", &self.goal),
            ("note", &self.note),
            ("met", &self.met),
        ] {
            if let Some(field) = field {
                value[name] = json!(field);
            }
        }
        if !self.paused && !self.suspended {
            if let Some(schedule) = Schedule::parse(&self.schedule) {
                let after = self.last_run_at.unwrap_or(self.created_at);
                value["nextRunAt"] = json!(schedule.next_after(after, local));
            }
        }
        value
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TriggerError {
    #[error("{0}")]
    File(String),
}

impl From<JsonFileError> for TriggerError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for TriggerError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// The Trigger book: loaded once, changed under a lock, written after every change.
pub struct Triggers {
    file: PathBuf,
    records: Mutex<Vec<TriggerRecord>>,
    /// The Tasks this process started from a Trigger, and its kind, so usage
    /// can say where tokens went (`schedule`, ADR 0043).
    started: Mutex<HashMap<String, String>>,
    /// The Schedule each round in flight belongs to: Task id to (Agent, Trigger id).
    rounds: Mutex<HashMap<String, (String, String)>>,
    /// What each Agent proposed for its Idle Work list, not signed (ADR 0056).
    drafts_file: PathBuf,
    drafts: Mutex<HashMap<String, Vec<String>>>,
    /// Tasks that were refused something nobody could be asked about (ADR 0079).
    skipped: Mutex<HashSet<String>>,
}

/// The most one background round may run, a Schedule's or a piece of Idle
/// Work, before it ends as if stopped. A person waiting to write waits behind
/// it at most this long (ADR 0056, 0080); it is the Runtime's, not a setting.
pub const BACKGROUND_LIMIT_S: u64 = 15 * 60;

/// The most an Agent's Idle Work draft holds.
pub const DRAFT_MAX: usize = 50;

impl Triggers {
    pub fn open(home: &Path) -> Result<Self, TriggerError> {
        let file = supervisor_dir(home)?.join("triggers.json");
        let mut records: Vec<TriggerRecord> = read_json_file(&file)?
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            // A row this build cannot read is dropped, not fatal.
            .filter_map(|record| serde_json::from_value(record).ok())
            .collect();
        // A piece working when the Runtime went down had its Turn closed as
        // interrupted (ADR 0033): it did not finish.
        for record in records.iter_mut() {
            for held in record.progress.values_mut() {
                if held.status == crate::idle::Status::Working {
                    held.status = crate::idle::Status::TimedOut;
                }
            }
        }
        let drafts_file = supervisor_dir(home)?.join("idle-drafts.json");
        let drafts = read_json_file(&drafts_file)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        Ok(Self {
            file,
            records: Mutex::new(records),
            started: Mutex::new(HashMap::new()),
            rounds: Mutex::new(HashMap::new()),
            drafts_file,
            drafts: Mutex::new(drafts),
            skipped: Mutex::new(HashSet::new()),
        })
    }

    /// What `trigger.listed` says of one Agent: its Triggers, and its Idle Work draft.
    pub fn listed_body(&self, agent: &str) -> Value {
        let held: Vec<Value> = self
            .for_agent(agent)
            .iter()
            .map(|record| record.listed(&MachineTime))
            .collect();
        let mut body = json!({ "agent": agent, "triggers": held });
        if let Some(draft) = self.drafts.lock().expect("drafts").get(agent) {
            if !draft.is_empty() {
                body["draft"] = json!(draft);
            }
        }
        body
    }

    /// Adds what the Agent proposed to its draft, up to DRAFT_MAX; the same words twice are kept once.
    pub fn propose(&self, agent: &str, items: &[String]) -> Result<(), TriggerError> {
        let mut drafts = self.drafts.lock().expect("drafts");
        let draft = drafts.entry(agent.to_string()).or_default();
        for item in items {
            if draft.len() < DRAFT_MAX && !draft.contains(item) {
                draft.push(item.clone());
            }
        }
        let value = serde_json::to_value(&*drafts).unwrap_or(Value::Null);
        drop(drafts);
        write_json_file(&self.drafts_file, &value)?;
        Ok(())
    }

    /// A signed list replaces the draft: the Member has read it.
    pub fn clear_draft(&self, agent: &str) -> Result<(), TriggerError> {
        let mut drafts = self.drafts.lock().expect("drafts");
        if drafts.remove(agent).is_none() {
            return Ok(());
        }
        let value = serde_json::to_value(&*drafts).unwrap_or(Value::Null);
        drop(drafts);
        write_json_file(&self.drafts_file, &value)?;
        Ok(())
    }

    /// The Agent's Idle Work list, if it has one.
    pub fn idle_of(&self, agent: &str) -> Option<TriggerRecord> {
        self.records
            .lock()
            .expect("triggers")
            .iter()
            .find(|held| held.agent == agent && held.kind == "idle")
            .cloned()
    }

    /// Notes that a Task was refused something nobody could be asked about.
    pub fn skipped(&self, task: &str) {
        self.skipped
            .lock()
            .expect("skipped")
            .insert(task.to_string());
    }

    /// The Idle Work piece a Task is the round of: its Agent, list, piece and signer.
    pub fn piece_of(&self, task: &str) -> Option<(String, String, String, String)> {
        self.records
            .lock()
            .expect("triggers")
            .iter()
            .find_map(|record| {
                record.progress.iter().find_map(|(item, held)| {
                    (held.task.as_deref() == Some(task)).then(|| {
                        (
                            record.agent.clone(),
                            record.id.clone(),
                            item.clone(),
                            record.member.clone(),
                        )
                    })
                })
            })
    }

    /// A piece's Turn ended: its piece is done, waits again, or is marked. True when it was one.
    pub fn finish_piece(&self, task: &str, ended: &Value) -> Result<bool, TriggerError> {
        let Some((agent, id, item, _)) = self.piece_of(task) else {
            return Ok(false);
        };
        let skipped = self.skipped.lock().expect("skipped").remove(task);
        let outcome = crate::idle::Outcome::of(ended, skipped);
        self.update(&agent, &id, |record| {
            if let Some(held) = record.progress.get(&item) {
                if held.status == crate::idle::Status::Working {
                    let next = crate::idle::finished(held, outcome);
                    record.progress.insert(item.clone(), next);
                }
            }
        })
    }

    /// A Schedule round's Turn ended (ADR 0083): an error counts one more failure
    /// in a row, a done or quiet round clears the count, a Stop or a spent Budget
    /// leaves it. The third failure in a row pauses the Schedule. The round's
    /// Agent, Schedule and signer, and whether this end paused it; None for a
    /// Task that is no Schedule round.
    pub fn finish_round(
        &self,
        task: &str,
        ended: &Value,
    ) -> Result<Option<(String, String, String, bool)>, TriggerError> {
        let Some((agent, id)) = self.rounds.lock().expect("rounds").remove(task) else {
            return Ok(None);
        };
        let reason = ended.get("reason").and_then(Value::as_str).unwrap_or("");
        // A spent Budget ends the Turn as an error too, but the Schedule did nothing wrong.
        let budget = ended
            .get("code")
            .and_then(Value::as_str)
            .is_some_and(|code| code.starts_with("budget."));
        let mut paused_now = false;
        let mut member = String::new();
        self.update(&agent, &id, |record| {
            member = record.member.clone();
            match reason {
                "error" if !budget => {
                    record.failed_rounds += 1;
                    if record.failed_rounds >= FAILED_ROUNDS_TO_PAUSE && !record.paused {
                        record.paused = true;
                        record.paused_for = Some("failures".to_string());
                        paused_now = true;
                    }
                }
                "done" | "quiet" => record.failed_rounds = 0,
                _ => {}
            }
        })?;
        Ok(Some((agent, id, member, paused_now)))
    }

    /// A round of a Schedule with a goal saved its progress (ADR 0085).
    pub fn noted(&self, task: &str, note: &str) -> Result<Option<(String, String)>, TriggerError> {
        let Some((agent, id)) = self.rounds.lock().expect("rounds").get(task).cloned() else {
            return Ok(None);
        };
        let mut member = None;
        self.update(&agent, &id, |record| {
            if record.goal.is_some() {
                record.note = Some(note.chars().take(2000).collect());
                member = Some(record.member.clone());
            }
        })?;
        Ok(member.map(|member| (agent, member)))
    }

    /// A round said the goal is met: the Schedule stops until a Member resumes it (ADR 0085).
    pub fn met(&self, task: &str, reason: &str) -> Result<Option<(String, String)>, TriggerError> {
        let Some((agent, id)) = self.rounds.lock().expect("rounds").get(task).cloned() else {
            return Ok(None);
        };
        let mut member = None;
        self.update(&agent, &id, |record| {
            if record.goal.is_some() && !record.paused {
                record.paused = true;
                record.paused_for = Some("goal".to_string());
                record.met = Some(reason.chars().take(2000).collect());
                member = Some(record.member.clone());
            }
        })?;
        Ok(member.map(|member| (agent, member)))
    }

    /// Keep this Trigger, replacing one with the same Agent and id whole.
    pub fn set(&self, record: TriggerRecord) -> Result<(), TriggerError> {
        let mut records = self.records.lock().expect("triggers");
        records.retain(|held| !(held.agent == record.agent && held.id == record.id));
        records.push(record);
        drop(records);
        self.save()
    }

    /// Change one Trigger; false when the Agent has none with that id.
    pub fn update(
        &self,
        agent: &str,
        id: &str,
        change: impl FnOnce(&mut TriggerRecord),
    ) -> Result<bool, TriggerError> {
        let mut records = self.records.lock().expect("triggers");
        let Some(record) = records
            .iter_mut()
            .find(|held| held.agent == agent && held.id == id)
        else {
            return Ok(false);
        };
        change(record);
        drop(records);
        self.save()?;
        Ok(true)
    }

    pub fn delete(&self, agent: &str, id: &str) -> Result<bool, TriggerError> {
        let mut records = self.records.lock().expect("triggers");
        let before = records.len();
        records.retain(|held| !(held.agent == agent && held.id == id));
        let removed = records.len() != before;
        drop(records);
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    pub fn get(&self, agent: &str, id: &str) -> Option<TriggerRecord> {
        self.records
            .lock()
            .expect("triggers")
            .iter()
            .find(|held| held.agent == agent && held.id == id)
            .cloned()
    }

    pub fn for_agent(&self, agent: &str) -> Vec<TriggerRecord> {
        self.records
            .lock()
            .expect("triggers")
            .iter()
            .filter(|held| held.agent == agent)
            .cloned()
            .collect()
    }

    pub fn all(&self) -> Vec<TriggerRecord> {
        self.records.lock().expect("triggers").clone()
    }

    /// Suspend every Trigger a revoked key signed, at once (ADR 0031).
    pub fn suspend_keys(&self, keys: &[String]) -> Result<(), TriggerError> {
        if keys.is_empty() {
            return Ok(());
        }
        let mut records = self.records.lock().expect("triggers");
        let mut changed = false;
        for record in records.iter_mut() {
            if !record.suspended && keys.contains(&record.key) {
                record.suspended = true;
                changed = true;
            }
        }
        drop(records);
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// Remember that this Task is a round of a Trigger of this kind.
    pub fn started(&self, task: &str, kind: &str) {
        self.started
            .lock()
            .expect("started")
            .insert(task.to_string(), kind.to_string());
    }

    /// Where a Task's tokens go in `usage`: its Trigger's kind, else `task`.
    pub fn source_of(&self, task: &str) -> String {
        self.started
            .lock()
            .expect("started")
            .get(task)
            .cloned()
            .unwrap_or_else(|| "task".to_string())
    }

    fn save(&self) -> Result<(), TriggerError> {
        let records = self.records.lock().expect("triggers");
        let value = serde_json::to_value(&*records).unwrap_or(Value::Array(Vec::new()));
        write_json_file(&self.file, &value)?;
        let _ = fs::set_permissions(&self.file, fs::Permissions::from_mode(0o600));
        Ok(())
    }
}

/// A Task id for a round nobody typed: random, in the shape a Controller's are.
pub fn new_task_id() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        // ponytail: no urandom means a broken Machine; the clock still keeps ids apart.
        bytes[..8].copy_from_slice(&(crate::usage::now_ms() as u64).to_le_bytes());
    }
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("tr-{hex}")
}

/// Starts one round in a new Task, in the name of whoever set the Trigger.
/// The Task id, or None when the Agent has no worker running.
///
/// `attended` is a Member who pressed "run now": that round asks for Approvals
/// as any Turn does. `approves` is whether the signer still has Approve: without
/// it the Schedule's scope is not sent and the round may do only the Allowlist
/// (ADR 0079).
pub fn start_round(
    workers: &crate::workers::Workers,
    triggers: &Triggers,
    record: &TriggerRecord,
    at: u64,
    attended: bool,
    approves: bool,
) -> Option<String> {
    send_round(
        workers,
        triggers,
        record,
        at,
        attended,
        approves,
        &round_text(record),
        Some(BACKGROUND_LIMIT_S),
    )
}

/// A Schedule round's words: what was signed, then its goal and the latest
/// progress note, the note as data since the Agent may have copied it from a page (ADR 0085).
fn round_text(record: &TriggerRecord) -> String {
    let Some(goal) = record.goal.as_deref().filter(|_| record.kind == "schedule") else {
        return record.text.clone();
    };
    let note = record.note.as_deref().map_or_else(
        || "No progress noted yet.".to_string(),
        |note| veeloe_runtime_core::untrusted("progress", note),
    );
    format!(
        "{}\n\nThis Schedule's goal: {goal}\nCall goal_note with where it stands before you end, and goal_met with the reason once it is met.\nLatest progress note:\n{note}",
        record.text
    )
}

/// Starts the next piece of an Agent's Idle Work list, with its time limit, and
/// marks it working (ADR 0056). The Task id, or None when nothing went.
pub fn start_piece(
    workers: &crate::workers::Workers,
    triggers: &Triggers,
    record: &TriggerRecord,
    now: u64,
    attended: bool,
    approves: bool,
) -> Option<String> {
    let list = crate::idle::IdleList::parse(record.idle.as_ref()?)?;
    let piece = list.next(&record.progress)?.clone();
    let task = send_round(
        workers,
        triggers,
        record,
        now,
        attended,
        approves,
        &piece.text,
        Some(BACKGROUND_LIMIT_S),
    )?;
    let _ = triggers.update(&record.agent, &record.id, |held| {
        held.last_run_at = Some(now);
        held.progress.insert(
            piece.id.clone(),
            crate::idle::Progress {
                status: crate::idle::Status::Working,
                last_run_at: Some(now),
                task: Some(task.clone()),
            },
        );
    });
    Some(task)
}

#[allow(clippy::too_many_arguments)]
fn send_round(
    workers: &crate::workers::Workers,
    triggers: &Triggers,
    record: &TriggerRecord,
    at: u64,
    attended: bool,
    approves: bool,
    text: &str,
    limit_s: Option<u64>,
) -> Option<String> {
    let task = new_task_id();
    let sent = workers.send(
        &record.agent,
        veeloe_runtime_core::ToWorker::Run {
            task: task.clone(),
            member: record.member.clone(),
            text: text.to_string(),
            trigger: veeloe_runtime_core::TriggerRun {
                kind: record.kind.clone(),
                id: record.id.clone(),
                at,
                attended,
                allow: if approves {
                    record.allow.clone()
                } else {
                    Vec::new()
                },
                limit_s,
                goal: record.kind == "schedule" && record.goal.is_some(),
            },
        },
    );
    if !sent {
        return None;
    }
    triggers.started(&task, &record.kind);
    if record.kind == "schedule" {
        triggers
            .rounds
            .lock()
            .expect("rounds")
            .insert(task.clone(), (record.agent.clone(), record.id.clone()));
    }
    Some(task)
}

/// The name the Agent's model gave a Schedule: kept, and the whole list sent
/// again to whoever set it, so their screen shows the name without asking.
pub fn titled(
    triggers: &Triggers,
    outbox: &dyn crate::tasks::Outbox,
    agent: &str,
    id: &str,
    title: &str,
) {
    let mut member = None;
    let _ = triggers.update(agent, id, |held| {
        held.title = Some(title.to_string());
        member = Some(held.member.clone());
    });
    let Some(member) = member else {
        return;
    };
    outbox.to_member(&member, "trigger.listed", triggers.listed_body(agent), None);
}

/// A wall-clock moment on the Machine, in its own time zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Civil {
    pub year: i32,
    /// 1 to 12.
    pub month: u32,
    /// May run past the month's end: [`LocalTime::to_ms`] rolls it over.
    pub day: u32,
    /// 0 is Sunday.
    pub weekday: u32,
    pub hour: u32,
    pub minute: u32,
}

/// The Machine's time zone, so a test can stand in for it.
pub trait LocalTime: Send + Sync {
    fn civil(&self, ms: u64) -> Civil;
    /// The moment this local date and time is; days past the month roll over.
    fn to_ms(&self, year: i32, month: u32, day: u32, hour: u32, minute: u32) -> u64;
}

/// The Machine's own clock, through libc (`localtime_r`, `mktime`), which knows
/// its time zone and daylight saving.
pub struct MachineTime;

impl LocalTime for MachineTime {
    fn civil(&self, ms: u64) -> Civil {
        let seconds = (ms / 1000) as libc::time_t;
        // SAFETY: localtime_r writes only into `parts`.
        let mut parts: libc::tm = unsafe { std::mem::zeroed() };
        unsafe { libc::localtime_r(&seconds, &mut parts) };
        Civil {
            year: parts.tm_year + 1900,
            month: (parts.tm_mon + 1) as u32,
            day: parts.tm_mday as u32,
            weekday: parts.tm_wday as u32,
            hour: parts.tm_hour as u32,
            minute: parts.tm_min as u32,
        }
    }

    fn to_ms(&self, year: i32, month: u32, day: u32, hour: u32, minute: u32) -> u64 {
        // SAFETY: mktime reads and normalises only `parts`.
        let mut parts: libc::tm = unsafe { std::mem::zeroed() };
        parts.tm_year = year - 1900;
        parts.tm_mon = month as i32 - 1;
        parts.tm_mday = day as i32;
        parts.tm_hour = hour as i32;
        parts.tm_min = minute as i32;
        parts.tm_isdst = -1;
        let seconds = unsafe { libc::mktime(&mut parts) };
        (seconds.max(0) as u64) * 1000
    }
}

/// When a Schedule runs, read from its signed structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schedule {
    Every { minutes: u64 },
    Daily { hour: u32, minute: u32 },
    Weekly { day: u32, hour: u32, minute: u32 },
}

fn clock(value: Option<&Value>) -> Option<(u32, u32)> {
    let text = value?.as_str()?;
    if !veeloe_protocol::messages::is_clock(text) {
        return None;
    }
    Some((text[..2].parse().ok()?, text[3..].parse().ok()?))
}

impl Schedule {
    pub fn parse(value: &Value) -> Option<Self> {
        if !veeloe_protocol::messages::is_schedule(value) {
            return None;
        }
        if let Some(every) = value.get("every") {
            return Some(Self::Every {
                minutes: every.get("minutes")?.as_u64()?,
            });
        }
        if let Some(daily) = value.get("daily") {
            let (hour, minute) = clock(daily.get("at"))?;
            return Some(Self::Daily { hour, minute });
        }
        let weekly = value.get("weekly")?;
        let (hour, minute) = clock(weekly.get("at"))?;
        Some(Self::Weekly {
            day: weekly.get("day")?.as_u64()? as u32,
            hour,
            minute,
        })
    }

    /// The first round strictly after `after`.
    pub fn next_after(&self, after: u64, local: &dyn LocalTime) -> u64 {
        match *self {
            Self::Every { minutes } => after + minutes * 60_000,
            Self::Daily { hour, minute } => {
                let today = local.civil(after);
                (0..=2)
                    .map(|ahead| {
                        local.to_ms(today.year, today.month, today.day + ahead, hour, minute)
                    })
                    .find(|at| *at > after)
                    .unwrap_or(after + 86_400_000)
            }
            Self::Weekly { day, hour, minute } => {
                let today = local.civil(after);
                (0..=7)
                    .filter(|ahead| (today.weekday + ahead) % 7 == day)
                    .map(|ahead| {
                        local.to_ms(today.year, today.month, today.day + ahead, hour, minute)
                    })
                    .find(|at| *at > after)
                    .unwrap_or_else(|| {
                        local.to_ms(today.year, today.month, today.day + 7, hour, minute)
                    })
            }
        }
    }

    /// The latest round due in `(since, now]`, however many were missed: a
    /// Machine that was off runs once, for the last one (issue #56).
    pub fn due(&self, since: u64, now: u64, local: &dyn LocalTime) -> Option<u64> {
        let first = self.next_after(since, local);
        if first > now {
            return None;
        }
        if let Self::Every { minutes } = *self {
            let step = minutes * 60_000;
            return Some(first + (now - first) / step * step);
        }
        let mut due = first;
        loop {
            let next = self.next_after(due, local);
            if next > now {
                return Some(due);
            }
            due = next;
        }
    }
}

/// What one Trigger's round comes to at this moment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Round {
    /// Nothing due, or the Agent is in the trash (its round waits for a restore).
    Wait,
    /// Its key was revoked or its Member lost Use.
    Suspend,
    /// Due, but the Agent is busy or its Budget is spent: skipped, not queued.
    Skip {
        at: u64,
        why: &'static str,
    },
    Run {
        at: u64,
    },
}

/// What the loop knows of a Trigger's Agent and signer right now.
pub struct Now {
    pub ms: u64,
    pub in_trash: bool,
    pub allowed: bool,
    pub busy: bool,
    pub budget_spent: bool,
}

/// Whether a round is due and may run (issue #56). The order matters: the
/// trash waits without spending the round, a revoked key suspends before
/// anything is due, and a due round that cannot run is skipped.
pub fn decide(record: &TriggerRecord, now: &Now, local: &dyn LocalTime) -> Round {
    if record.paused || record.suspended || now.in_trash {
        return Round::Wait;
    }
    if !now.allowed {
        return Round::Suspend;
    }
    let Some(schedule) = Schedule::parse(&record.schedule) else {
        return Round::Wait;
    };
    let since = record.last_run_at.unwrap_or(record.created_at);
    let Some(at) = schedule.due(since, now.ms, local) else {
        return Round::Wait;
    };
    if now.busy {
        return Round::Skip { at, why: "busy" };
    }
    if now.budget_spent {
        return Round::Skip {
            at,
            why: "budget.exhausted",
        };
    }
    Round::Run { at }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// UTC, with civil dates worked out by hand: the same answers on every Machine.
    struct Utc;

    fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
        let y = if month <= 2 { year - 1 } else { year };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    impl LocalTime for Utc {
        fn civil(&self, ms: u64) -> Civil {
            let days = (ms / 86_400_000) as i64;
            let z = days + 719_468;
            let era = z.div_euclid(146_097);
            let doe = z - era * 146_097;
            let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let day = doy - (153 * mp + 2) / 5 + 1;
            let month = if mp < 10 { mp + 3 } else { mp - 9 };
            let year = yoe + era * 400 + i64::from(month <= 2);
            let of_day = ms % 86_400_000;
            Civil {
                year: year as i32,
                month: month as u32,
                day: day as u32,
                weekday: ((days + 4).rem_euclid(7)) as u32,
                hour: (of_day / 3_600_000) as u32,
                minute: (of_day / 60_000 % 60) as u32,
            }
        }

        fn to_ms(&self, year: i32, month: u32, day: u32, hour: u32, minute: u32) -> u64 {
            let days = days_from_civil(year as i64, month as i64, 1) + day as i64 - 1;
            (days as u64) * 86_400_000 + (hour as u64) * 3_600_000 + (minute as u64) * 60_000
        }
    }

    /// 2026-11-25 (a Wednesday) at `hour:minute` UTC.
    fn wednesday(hour: u32, minute: u32) -> u64 {
        Utc.to_ms(2026, 11, 25, hour, minute)
    }

    fn record(schedule: Value) -> TriggerRecord {
        TriggerRecord {
            id: "tr_1".into(),
            kind: "schedule".into(),
            agent: "a1".into(),
            member: "m_1".into(),
            key: "k1".into(),
            text: "check".into(),
            schedule,
            idle: None,
            progress: Default::default(),
            notify: None,
            paused: false,
            failed_rounds: 0,
            paused_for: None,
            goal: None,
            note: None,
            met: None,
            suspended: false,
            created_at: wednesday(0, 0),
            last_run_at: None,
            title: None,
            allow: Vec::new(),
            last_skip: None,
            envelope: json!({}),
        }
    }

    #[test]
    fn three_failed_rounds_in_a_row_pause_a_schedule_and_a_good_round_clears_the_count() {
        let home = tempdir().expect("home");
        let triggers = Triggers::open(home.path()).expect("open");
        triggers
            .set(record(json!({ "every": "day" })))
            .expect("set");
        let round = |task: &str, reason: &str| {
            let ended = if reason == "budget" {
                json!({ "reason": "error", "code": "budget.exhausted" })
            } else {
                json!({ "reason": reason })
            };
            triggers
                .rounds
                .lock()
                .expect("rounds")
                .insert(task.into(), ("a1".into(), "tr_1".into()));
            triggers.finish_round(task, &ended).expect("finish")
        };
        let held = || triggers.get("a1", "tr_1").expect("held");
        assert_eq!(round("t1", "error").map(|r| r.3), Some(false));
        assert_eq!(round("t2", "error").map(|r| r.3), Some(false));
        // A done round clears the count; a Stop or a spent Budget leaves it.
        round("t3", "done");
        assert_eq!(held().failed_rounds, 0);
        round("t4", "error");
        round("t5", "stopped");
        round("t6", "budget");
        assert_eq!(held().failed_rounds, 1);
        round("t7", "error");
        let third = round("t8", "error").expect("a round");
        assert_eq!((third.2.as_str(), third.3), ("m_1", true));
        assert!(held().paused);
        assert_eq!(held().paused_for.as_deref(), Some("failures"));
        assert_eq!(held().listed(&Utc)["pausedFor"], json!("failures"));
        // A Task that is no Schedule round is not counted.
        assert_eq!(
            triggers
                .finish_round("typed", &json!({ "reason": "error" }))
                .expect("finish"),
            None
        );
    }

    #[test]
    fn a_goal_rides_each_round_its_note_is_kept_and_meeting_it_stops_the_schedule() {
        let home = tempdir().expect("home");
        let triggers = Triggers::open(home.path()).expect("open");
        let mut plain = record(json!({ "every": "day" }));
        assert_eq!(round_text(&plain), plain.text);
        plain.goal = Some("PR #41 is merged".into());
        triggers.set(plain).expect("set");
        triggers
            .rounds
            .lock()
            .expect("rounds")
            .insert("t1".into(), ("a1".into(), "tr_1".into()));
        let held = || triggers.get("a1", "tr_1").expect("held");
        assert!(round_text(&held()).contains("No progress noted yet."));
        triggers.noted("t1", "still open").expect("noted");
        let text = round_text(&held());
        assert!(text.contains("This Schedule's goal: PR #41 is merged"));
        assert!(text.contains("<data source=\"progress\""), "{text}");
        assert!(text.contains("still open"));
        let met = triggers.met("t1", "merged at 10:02").expect("met");
        assert_eq!(met, Some(("a1".into(), "m_1".into())));
        assert!(held().paused);
        assert_eq!(held().listed(&Utc)["pausedFor"], json!("goal"));
        assert_eq!(held().listed(&Utc)["met"], json!("merged at 10:02"));
        // Met once is enough: a second call says nothing new.
        assert_eq!(triggers.met("t1", "again").expect("met"), None);
    }

    fn now(ms: u64) -> Now {
        Now {
            ms,
            in_trash: false,
            allowed: true,
            busy: false,
            budget_spent: false,
        }
    }

    #[test]
    fn the_machines_own_clock_reads_back_the_local_time_it_was_given() {
        let at = MachineTime.to_ms(2026, 11, 25, 9, 0);
        let back = MachineTime.civil(at);
        assert_eq!((back.year, back.month, back.day), (2026, 11, 25));
        assert_eq!((back.hour, back.minute, back.weekday), (9, 0, 3));
        // A day past the month's end rolls over, as daily rounds rely on.
        let next = MachineTime.civil(MachineTime.to_ms(2026, 11, 31, 9, 0));
        assert_eq!((next.month, next.day), (12, 1));
    }

    #[test]
    fn daily_and_weekly_rounds_fall_on_the_machines_clock() {
        let daily = Schedule::Daily { hour: 9, minute: 0 };
        assert_eq!(daily.next_after(wednesday(8, 0), &Utc), wednesday(9, 0));
        assert_eq!(
            daily.next_after(wednesday(9, 0), &Utc),
            Utc.to_ms(2026, 11, 26, 9, 0)
        );
        // Monday after a Wednesday, across the month's end.
        let monday = Schedule::Weekly {
            day: 1,
            hour: 8,
            minute: 30,
        };
        assert_eq!(
            monday.next_after(wednesday(12, 0), &Utc),
            Utc.to_ms(2026, 11, 30, 8, 30)
        );
        let wednesday_noon = Schedule::Weekly {
            day: 3,
            hour: 12,
            minute: 0,
        };
        assert_eq!(
            wednesday_noon.next_after(wednesday(12, 0), &Utc),
            Utc.to_ms(2026, 12, 2, 12, 0)
        );
        assert_eq!(
            Schedule::Every { minutes: 15 }.next_after(wednesday(0, 0), &Utc),
            wednesday(0, 15)
        );
    }

    #[test]
    fn a_machine_that_was_off_runs_once_for_the_last_missed_round() {
        let daily = record(json!({ "daily": { "at": "09:00" } }));
        let three_days_later = Utc.to_ms(2026, 11, 28, 10, 0);
        assert_eq!(
            decide(&daily, &now(three_days_later), &Utc),
            Round::Run {
                at: Utc.to_ms(2026, 11, 28, 9, 0)
            }
        );
        let every = record(json!({ "every": { "minutes": 15 } }));
        assert_eq!(
            decide(&every, &now(wednesday(1, 7)), &Utc),
            Round::Run {
                at: wednesday(1, 0)
            }
        );
        assert_eq!(decide(&every, &now(wednesday(0, 14)), &Utc), Round::Wait);
    }

    #[test]
    fn a_busy_agent_or_a_spent_budget_skips_the_round() {
        let daily = record(json!({ "daily": { "at": "09:00" } }));
        let at = wednesday(9, 0);
        let busy = Now {
            busy: true,
            ..now(at)
        };
        assert_eq!(decide(&daily, &busy, &Utc), Round::Skip { at, why: "busy" });
        let spent = Now {
            budget_spent: true,
            ..now(at)
        };
        assert_eq!(
            decide(&daily, &spent, &Utc),
            Round::Skip {
                at,
                why: "budget.exhausted"
            }
        );
    }

    #[test]
    fn the_trash_waits_a_revoked_key_suspends_and_a_pause_holds() {
        let daily = record(json!({ "daily": { "at": "09:00" } }));
        let at = wednesday(9, 0);
        let trash = Now {
            in_trash: true,
            ..now(at)
        };
        assert_eq!(decide(&daily, &trash, &Utc), Round::Wait);
        let revoked = Now {
            allowed: false,
            ..now(at)
        };
        assert_eq!(decide(&daily, &revoked, &Utc), Round::Suspend);
        let paused = TriggerRecord {
            paused: true,
            ..daily
        };
        assert_eq!(decide(&paused, &now(at), &Utc), Round::Wait);
    }

    #[test]
    fn triggers_reload_replace_by_id_and_a_revoked_key_suspends_its_own() {
        let home = tempdir().expect("home");
        let triggers = Triggers::open(home.path()).expect("open");
        triggers
            .set(record(json!({ "daily": { "at": "09:00" } })))
            .expect("set");
        triggers
            .set(TriggerRecord {
                text: "replaced".into(),
                ..record(json!({ "daily": { "at": "10:00" } }))
            })
            .expect("replace");
        triggers
            .set(TriggerRecord {
                id: "tr_2".into(),
                key: "k2".into(),
                ..record(json!({ "every": { "minutes": 60 } }))
            })
            .expect("second");
        triggers.suspend_keys(&["k1".into()]).expect("suspend");

        let reloaded = Triggers::open(home.path()).expect("reload");
        let held = reloaded.for_agent("a1");
        assert_eq!(held.len(), 2);
        let first = reloaded.get("a1", "tr_1").expect("tr_1");
        assert_eq!(first.text, "replaced");
        assert!(first.suspended);
        assert!(!reloaded.get("a1", "tr_2").expect("tr_2").suspended);
    }

    #[test]
    fn a_listed_trigger_says_its_next_round_unless_it_cannot_run() {
        let daily = record(json!({ "daily": { "at": "09:00" } }));
        assert_eq!(daily.listed(&Utc)["nextRunAt"], json!(wednesday(9, 0)));
        let paused = TriggerRecord {
            paused: true,
            ..daily
        };
        assert!(paused.listed(&Utc).get("nextRunAt").is_none());
    }
}
