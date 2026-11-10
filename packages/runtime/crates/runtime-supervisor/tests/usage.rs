//! The daily Budget and its tally, ported from
//! `packages/runtime-legacy/src/supervisor/{usage/store,budget}`.

use tempfile::tempdir;
use std::fs;
use veeloe_runtime_supervisor::agents::Agent;
use veeloe_runtime_supervisor::usage::{
    budget_day_with_offset, shift_day, Budgets, UsageStore, DEFAULT_BUDGET,
};

fn agent(budget: Option<u64>) -> Agent {
    Agent {
        id: "a1".into(),
        name: "Deployer".into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        approval_timeout_s: 3_600,
        budget,
    }
}

/// 2027-01-15T08:00:00Z, so a day boundary can be aimed at exactly.
const MORNING: i64 = 1_800_000_000_000;

#[test]
fn a_budget_day_turns_over_at_four_in_the_machines_own_time() {
    // 04:00 local is the first moment of the new day; one millisecond before is
    // still the old one.
    assert_eq!(
        budget_day_with_offset(MORNING - 4 * 3_600_000, 0),
        "2027-01-15"
    );
    assert_eq!(
        budget_day_with_offset(MORNING - 4 * 3_600_000 - 1, 0),
        "2027-01-14"
    );
    // The same moment is a different day at another offset.
    assert_eq!(
        budget_day_with_offset(MORNING - 4 * 3_600_000, 7 * 3_600),
        "2027-01-15"
    );
}

#[test]
fn tokens_are_tallied_per_agent_and_day_and_the_other_day_reads_zero() {
    let home = tempdir().expect("home");
    let store = UsageStore::open(&home.path().join("usage.db")).expect("store");
    let budgets = Budgets::new(store);
    let a1 = agent(None);

    let after = budgets.add(&a1, MORNING, "t1", 15).expect("add");
    assert_eq!(after.tokens, 15);
    assert_eq!(budgets.add(&a1, MORNING, "t1", 5).expect("add").tokens, 20);
    assert_eq!(
        budgets
            .add(&a1, MORNING, "t2", 7)
            .expect("add")
            .tokens,
        27
    );
    // Another Agent is its own tally.
    let other = Agent {
        id: "a2".into(),
        ..agent(None)
    };
    assert_eq!(
        budgets.usage_of(&other, MORNING).expect("usage").tokens,
        0
    );
    // A day later the same Agent starts again from zero.
    assert_eq!(
        budgets
            .usage_of(&a1, MORNING + 24 * 3_600_000)
            .expect("usage")
            .tokens,
        0
    );
}

#[test]
fn an_agent_is_exhausted_only_when_todays_tokens_reach_its_budget() {
    let home = tempdir().expect("home");
    let store = UsageStore::open(&home.path().join("usage.db")).expect("store");
    let budgets = Budgets::new(store);

    let small = agent(Some(10));
    assert_eq!(Budgets::limit_of(&small), 10);
    assert!(!budgets.exhausted(&small, MORNING).expect("exhausted"));
    budgets.add(&small, MORNING, "t1", 9).expect("add");
    assert!(!budgets.exhausted(&small, MORNING).expect("exhausted"));
    budgets.add(&small, MORNING, "t1", 1).expect("add");
    assert!(budgets.exhausted(&small, MORNING).expect("exhausted"));

    // No Budget set means the default, not zero.
    assert_eq!(Budgets::limit_of(&agent(None)), DEFAULT_BUDGET);
}

#[test]
fn a_range_keeps_the_days_it_has_and_the_biggest_tasks_first() {
    let home = tempdir().expect("home");
    let store = UsageStore::open(&home.path().join("usage.db")).expect("store");
    let a1 = agent(None);
    store.add(&a1.id, "2026-11-04", "task", "old", 10).unwrap();
    store.add(&a1.id, "2026-11-06", "task", "new", 30).unwrap();
    store.add(&a1.id, "2026-11-06", "task", "middle", 20).unwrap();
    for i in 0..25 {
        store
            .add(&a1.id, "2026-11-06", "task", &format!("small-{i}"), 1)
            .unwrap();
    }

    let range = store
        .range(&[a1.id.clone(), "a2".into()], "2026-11-05", "2026-11-06")
        .expect("range");
    assert_eq!(range.len(), 1, "an Agent with nothing is left out");
    let agent = &range[0];
    assert_eq!(agent.days.len(), 1);
    assert_eq!(agent.days[0].day, "2026-11-06");
    assert_eq!(agent.days[0].tokens, 75);
    assert_eq!(agent.tasks.len(), 20);
    assert_eq!(agent.tasks[0].task, "new");
    assert_eq!(agent.tasks[0].tokens, 30);
    assert_eq!(
        agent.sources,
        vec![veeloe_runtime_supervisor::usage::UsageSource {
            source: "task".into(),
            tokens: 75,
        }]
    );
}

#[test]
fn a_day_shifts_by_whole_calendar_days() {
    assert_eq!(shift_day("2026-11-06", -29), "2026-10-08");
    assert_eq!(shift_day("2026-03-01", -1), "2026-02-28");
    assert_eq!(shift_day("2026-01-01", -1), "2025-12-31");
    assert_eq!(shift_day("2026-11-09", 0), "2026-11-09");
}

#[test]
fn a_legacy_usage_json_is_imported_once_and_renamed() {
    let home = tempdir().expect("home");
    let dir = home.path().join("runtime");
    fs::create_dir_all(&dir).expect("runtime dir");
    fs::write(
        dir.join("usage.json"),
        r#"{"a1":{"day":"2026-11-06","tokens":2000}}"#,
    )
    .expect("legacy tally");

    let store = UsageStore::open(&dir.join("usage.db")).expect("store");
    assert_eq!(store.total("a1", "2026-11-06").expect("total"), 2_000);
    assert!(dir.join("usage.json.migrated").exists());

    let again = UsageStore::open(&dir.join("usage.db")).expect("reopen");
    assert_eq!(again.total("a1", "2026-11-06").expect("total"), 2_000);
}
