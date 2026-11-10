use std::cell::Cell;
use std::path::Path;
use std::process::Command;

use serde_json::json;
use tempfile::tempdir;
use veeloe_runtime_core::{Clock, EventStore};

struct FixedClock(Cell<i64>);

impl Clock for FixedClock {
    fn now(&self) -> i64 {
        self.0.get()
    }
}

fn open() -> (tempfile::TempDir, EventStore<FixedClock>) {
    let dir = tempdir().expect("tempdir");
    let store = EventStore::open_with(dir.path().join("tasks.db"), FixedClock(Cell::new(1_000)))
        .expect("open store");
    (dir, store)
}

#[test]
fn numbers_events_in_order_and_pages_after_a_sequence() {
    let (_dir, mut store) = open();
    store.create_task("t1", "m1").expect("create task");

    let first = store
        .append("t1", "member.message", &json!({ "text": "hi" }), Some("msg-1"))
        .expect("first event");
    let second = store
        .append("t1", "turn.started", &json!({ "member": "m1" }), None)
        .expect("second event");
    let third = store
        .append("t1", "turn.ended", &json!({ "reason": "done" }), None)
        .expect("third event");

    assert_eq!((first.seq, second.seq, third.seq), (1, 2, 3));
    assert_eq!(first.at, 1_000);
    assert_eq!(first.body, json!({ "text": "hi" }));
    assert_eq!(store.events("t1", 1).expect("events"), vec![second, third]);
    assert!(store.events("t1", 3).expect("events").is_empty());
}

#[test]
fn a_resent_message_id_is_refused_by_the_unique_constraint() {
    let (_dir, mut store) = open();
    store.create_task("t1", "m1").expect("create task");
    store
        .append("t1", "member.message", &json!({ "text": "hi" }), Some("msg-1"))
        .expect("first append");

    assert!(store.has_message("msg-1").expect("has message"));
    assert!(store
        .append("t1", "member.message", &json!({ "text": "again" }), Some("msg-1"))
        .is_err());
    assert!(!store.has_message("msg-2").expect("has message"));
}

#[test]
fn a_turn_is_open_only_while_its_latest_boundary_is_a_start() {
    let (_dir, mut store) = open();
    store.create_task("t1", "m1").expect("create task");
    store
        .append("t1", "turn.started", &json!({ "member": "m1" }), None)
        .expect("start");
    store
        .append("t1", "turn.ended", &json!({ "reason": "done" }), None)
        .expect("end");
    assert!(store.open_turns().expect("open turns").is_empty());

    store
        .append("t1", "turn.started", &json!({ "member": "m1" }), None)
        .expect("start again");
    assert_eq!(store.open_turns().expect("open turns"), vec!["t1"]);

    store
        .append("t1", "llm.message", &json!({ "content": [] }), None)
        .expect("llm");
    assert_eq!(store.open_turns().expect("open turns"), vec!["t1"]);

    store
        .append("t1", "turn.ended", &json!({ "reason": "stopped" }), None)
        .expect("end again");
    assert!(store.open_turns().expect("open turns").is_empty());
}

#[test]
fn lists_the_tasks_a_member_started_with_when_each_last_moved() {
    let (_dir, mut store) = open();
    store.create_task("t1", "m1").expect("create t1");
    store.create_task("t2", "m2").expect("create t2");
    store
        .append("t1", "member.message", &json!({ "text": "hi" }), None)
        .expect("event");

    assert_eq!(store.starter_of("t1").expect("starter"), Some("m1".into()));
    assert_eq!(store.starter_of("missing").expect("starter"), None);

    let tasks = store.tasks_started_by("m1").expect("tasks");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, "t1");
    assert_eq!(tasks[0].updated, 1_000);

    let m2 = store.tasks_started_by("m2").expect("tasks");
    assert_eq!(m2.len(), 1);
    assert_eq!(m2[0].id, "t2");
    assert!(store.tasks_started_by("m3").expect("tasks").is_empty());
}

#[test]
fn opens_a_database_written_by_the_legacy_runtime() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("tasks.db");
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../");
    // A frozen copy of the retired TypeScript store: the schema, not the Runtime.
    let legacy = root.join("packages/runtime/crates/runtime-core/tests/fixtures/sqlite-store.ts");

    let script = format!(
        "const {{ openEventStore }} = await import({legacy:?}); const store = openEventStore({db:?}); store.createTask(\"t1\", \"m1\"); store.append(\"t1\", \"member.message\", {{ text: \"hi\" }}, \"msg-1\"); store.close();",
        legacy = legacy.to_string_lossy(),
        db = db.to_string_lossy(),
    );
    let status = Command::new("bun")
        .arg("-e")
        .arg(script)
        .current_dir(&root)
        .status()
        .expect("run bun");
    assert!(status.success());

    let store = EventStore::open(&db).expect("open legacy database");
    assert_eq!(store.starter_of("t1").expect("starter"), Some("m1".into()));
    let events = store.events("t1", 0).expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "member.message");
    assert_eq!(events[0].body, json!({ "text": "hi" }));
}
