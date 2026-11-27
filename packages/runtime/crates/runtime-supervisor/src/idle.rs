//! Idle Work (ADR 0056, issue #57): a signed list an Agent works through when
//! nobody has needed it for a while, one piece at a time. This is the list's
//! own logic: what the signed `idle` says, which piece is next, when the Agent
//! counts as quiet, and what a finished Turn makes of its piece. The Trigger
//! book (`triggers.rs`) keeps each piece's progress; `main.rs` acts on it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// One piece of work, as signed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleItem {
    pub id: String,
    pub text: String,
    /// Goes back to wait again once done, instead of leaving the list.
    pub repeat: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Order {
    /// The first piece still waiting, in the order signed.
    Ordered,
    /// The piece that has waited longest: never run first, then oldest run.
    OldestFirst,
}

/// A signed Idle Work list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleList {
    pub items: Vec<IdleItem>,
    pub order: Order,
    pub quiet_minutes: u64,
    pub item_minutes: u64,
}

/// Where one piece stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<u64>,
    /// The Task of its latest round.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Pending,
    Working,
    Done,
    TimedOut,
    NeedsApproval,
}

/// How a piece's Turn ended, as far as its piece is concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Done,
    /// It ran out of time, was stopped, failed, or the Runtime restarted under it.
    TimedOut,
    /// It needed something outside the Allowlist and its scope (ADR 0079).
    NeedsApproval,
}

impl Outcome {
    /// From `turn.ended`'s body, and whether the Task wrote `approval.skipped`.
    pub fn of(ended: &Value, skipped: bool) -> Self {
        if skipped {
            return Self::NeedsApproval;
        }
        match ended.get("reason").and_then(Value::as_str) {
            Some("done" | "quiet") => Self::Done,
            _ => Self::TimedOut,
        }
    }
}

impl IdleList {
    /// The signed `idle` of a Trigger; None when it is not one.
    pub fn parse(value: &Value) -> Option<Self> {
        let items = value
            .get("items")?
            .as_array()?
            .iter()
            .map(|item| {
                Some(IdleItem {
                    id: item.get("id")?.as_str()?.to_string(),
                    text: item.get("text")?.as_str()?.to_string(),
                    repeat: item.get("repeat").and_then(Value::as_bool).unwrap_or(false),
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let order = match value.get("order")?.as_str()? {
            "ordered" => Order::Ordered,
            "oldest-first" => Order::OldestFirst,
            _ => return None,
        };
        Some(Self {
            items,
            order,
            quiet_minutes: value.get("quietMinutes")?.as_u64()?,
            item_minutes: value.get("itemMinutes")?.as_u64()?,
        })
    }

    /// The piece to start now, or None: one is already working, or none waits.
    pub fn next<'a>(&'a self, progress: &BTreeMap<String, Progress>) -> Option<&'a IdleItem> {
        let status = |item: &IdleItem| progress.get(&item.id).map(|p| p.status);
        if self
            .items
            .iter()
            .any(|item| status(item) == Some(Status::Working))
        {
            return None;
        }
        let waiting = self
            .items
            .iter()
            .filter(|item| matches!(status(item), None | Some(Status::Pending)));
        match self.order {
            Order::Ordered => waiting.into_iter().next(),
            // Never run sorts before any run; among run ones, the oldest; ties keep the signed order.
            Order::OldestFirst => waiting.min_by_key(|item| {
                progress
                    .get(&item.id)
                    .and_then(|p| p.last_run_at)
                    .map_or((0, 0), |at| (1, at))
            }),
        }
    }

    /// True when the Agent has been quiet long enough: its last Turn ended (or
    /// the supervisor started) at least `quiet_minutes` ago.
    pub fn quiet_enough(&self, now_ms: u64, quiet_since_ms: u64) -> bool {
        now_ms.saturating_sub(quiet_since_ms) >= self.quiet_minutes * 60_000
    }

    /// What `trigger.listed` shows: every piece still on the list, with where it
    /// stands. A one-off piece that is done is gone; a repeat one waits again.
    pub fn listed_progress(&self, progress: &BTreeMap<String, Progress>) -> Vec<Value> {
        self.items
            .iter()
            .filter_map(|item| {
                let held = progress.get(&item.id).cloned().unwrap_or(Progress {
                    status: Status::Pending,
                    last_run_at: None,
                    task: None,
                });
                if held.status == Status::Done && !item.repeat {
                    return None;
                }
                let mut value = json!({ "id": item.id, "status": held.status });
                if let Some(at) = held.last_run_at {
                    value["lastRunAt"] = json!(at);
                }
                if let Some(task) = held.task {
                    value["task"] = json!(task);
                }
                Some(value)
            })
            .collect()
    }
}

/// What a finished Turn leaves of its piece: a repeat piece that is done waits again.
pub fn finished(held: &Progress, outcome: Outcome, repeat: bool) -> Progress {
    let status = match outcome {
        Outcome::Done if repeat => Status::Pending,
        Outcome::Done => Status::Done,
        Outcome::TimedOut => Status::TimedOut,
        Outcome::NeedsApproval => Status::NeedsApproval,
    };
    Progress {
        status,
        ..held.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(order: &str) -> IdleList {
        IdleList::parse(&json!({
            "items": [
                { "id": "a", "text": "first" },
                { "id": "b", "text": "second", "repeat": true },
                { "id": "c", "text": "third" },
            ],
            "order": order,
            "quietMinutes": 15,
            "itemMinutes": 15,
        }))
        .expect("list")
    }

    fn at(status: Status, last_run_at: Option<u64>) -> Progress {
        Progress {
            status,
            last_run_at,
            task: None,
        }
    }

    #[test]
    fn ordered_takes_the_first_waiting_piece_and_nothing_while_one_works() {
        let list = list("ordered");
        let mut progress = BTreeMap::new();
        assert_eq!(list.next(&progress).map(|i| i.id.as_str()), Some("a"));
        progress.insert("a".into(), at(Status::Done, Some(1)));
        assert_eq!(list.next(&progress).map(|i| i.id.as_str()), Some("b"));
        progress.insert("b".into(), at(Status::Working, Some(2)));
        assert_eq!(list.next(&progress), None);
    }

    #[test]
    fn oldest_first_takes_a_never_run_piece_then_the_one_run_longest_ago() {
        let list = list("oldest-first");
        let mut progress = BTreeMap::new();
        progress.insert("a".into(), at(Status::Pending, Some(50)));
        progress.insert("b".into(), at(Status::Pending, Some(10)));
        assert_eq!(list.next(&progress).map(|i| i.id.as_str()), Some("c"));
        progress.insert("c".into(), at(Status::Pending, Some(30)));
        assert_eq!(list.next(&progress).map(|i| i.id.as_str()), Some("b"));
    }

    #[test]
    fn a_piece_that_needed_approval_or_ran_out_of_time_waits_for_a_person() {
        let list = list("ordered");
        let mut progress = BTreeMap::new();
        progress.insert("a".into(), at(Status::NeedsApproval, Some(1)));
        progress.insert("b".into(), at(Status::TimedOut, Some(1)));
        assert_eq!(list.next(&progress).map(|i| i.id.as_str()), Some("c"));
    }

    #[test]
    fn quiet_means_the_whole_quiet_time_since_the_last_turn() {
        let list = list("ordered");
        assert!(!list.quiet_enough(14 * 60_000, 0));
        assert!(list.quiet_enough(15 * 60_000, 0));
    }

    #[test]
    fn a_finished_turn_leaves_its_piece_done_waiting_again_or_marked() {
        let working = at(Status::Working, Some(5));
        let ended = |reason: &str| json!({ "reason": reason });
        assert_eq!(
            finished(&working, Outcome::of(&ended("done"), false), false).status,
            Status::Done
        );
        assert_eq!(
            finished(&working, Outcome::of(&ended("quiet"), false), true).status,
            Status::Pending
        );
        assert_eq!(
            finished(&working, Outcome::of(&ended("stopped"), false), false).status,
            Status::TimedOut
        );
        assert_eq!(
            finished(&working, Outcome::of(&ended("done"), true), false).status,
            Status::NeedsApproval
        );
    }

    #[test]
    fn the_list_shown_leaves_out_a_one_off_piece_once_done() {
        let list = list("ordered");
        let mut progress = BTreeMap::new();
        progress.insert("a".into(), at(Status::Done, Some(1)));
        progress.insert("b".into(), at(Status::Pending, Some(2)));
        let shown: Vec<String> = list
            .listed_progress(&progress)
            .iter()
            .map(|p| p["id"].as_str().unwrap_or_default().to_string())
            .collect();
        assert_eq!(shown, vec!["b", "c"]);
    }
}
