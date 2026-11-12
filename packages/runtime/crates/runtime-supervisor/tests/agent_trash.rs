//! The Agent trash as the registry keeps it: 30 days, no files touched, and a
//! second delete that never moves the expiry (`agent-trash`).

use std::sync::Arc;
use std::time::Duration;

use tempfile::tempdir;
use veeloe_runtime_core::{FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_supervisor::agents::{agent_dir, Agent, AgentRegistry, TRASH_DAYS};
use veeloe_runtime_supervisor::workers::{SupervisorLlm, Workers};

const DAY_MS: i64 = 24 * 60 * 60 * 1_000;

fn agent(id: &str) -> Agent {
    Agent {
        id: id.into(),
        name: "Deployer".into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
    }
}

#[test]
fn a_deleted_agent_waits_thirty_days_and_then_leaves_without_its_folder() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("add");
    let dir = agent_dir(home.path(), "a1").expect("workdir");

    let now = 1_800_000_000_000;
    assert!(registry.soft_delete("a1", now).expect("delete"));
    let kept = registry.get("a1").expect("registry").expect("kept");
    assert_eq!(kept.deleted_at, Some(now));
    assert_eq!(
        kept.restore_until(),
        Some(now + (TRASH_DAYS as i64) * DAY_MS)
    );

    // A second delete does not move the expiry.
    assert!(!registry
        .soft_delete("a1", now + DAY_MS)
        .expect("delete again"));
    assert_eq!(
        registry
            .get("a1")
            .expect("registry")
            .expect("kept")
            .deleted_at,
        Some(now)
    );

    // Day 29 keeps it; day 30 drops the row.
    assert_eq!(
        registry
            .purge_expired(now + 29 * DAY_MS)
            .expect("purge early"),
        0
    );
    assert!(registry.get("a1").expect("registry").is_some());
    assert_eq!(
        registry
            .purge_expired(now + (TRASH_DAYS as i64) * DAY_MS)
            .expect("purge"),
        1
    );
    assert!(registry.get("a1").expect("registry").is_none());
    assert!(dir.join("workdir").is_dir());
    assert!(dir.exists());
}

#[test]
fn restore_puts_the_agent_back_and_leaves_one_in_use_alone() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("add");
    registry.add(&agent("a2")).expect("add");

    let now = 1_800_000_000_000;
    assert!(registry.soft_delete("a1", now).expect("delete"));
    assert!(!registry.soft_delete("missing", now).expect("no agent"));

    // An Agent that was never deleted is not changed by a restore.
    assert!(!registry.restore("a2").expect("restore a2"));
    assert!(registry
        .get("a2")
        .expect("registry")
        .expect("a2")
        .deleted_at
        .is_none());

    assert!(registry.restore("a1").expect("restore"));
    let back = registry.get("a1").expect("registry").expect("back");
    assert!(back.deleted_at.is_none());
    assert_eq!(back.restore_until(), None);

    // Purging an empty trash writes nothing and keeps both Agents.
    assert_eq!(registry.purge_expired(now).expect("purge"), 0);
    assert_eq!(registry.all().expect("all").len(), 2);
}

struct Silent;

#[async_trait::async_trait]
impl SupervisorLlm for Silent {
    async fn answer(&self, _agent: &str, _request: LlmHttpRequest) -> LlmHttpResponse {
        LlmHttpResponse {
            status: 500,
            headers: Vec::new(),
            body: String::new(),
        }
    }
}

fn workers(home: &std::path::Path, marker: &std::path::Path) -> Workers {
    Workers::new(
        home.to_path_buf(),
        vec![
            "/bin/sh".into(),
            "-c".into(),
            format!("touch {}", marker.display()),
        ],
        Arc::new(Silent) as Arc<dyn SupervisorLlm>,
        Arc::new(|_agent: &str, _message: FromWorker| {}),
        Arc::new(|_line: &str| {}),
        Arc::new(|_agent, command| command),
    )
}

#[tokio::test]
async fn a_worker_starts_for_an_agent_in_use_but_not_for_one_in_the_trash() {
    let home = tempdir().expect("home");
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("live")).expect("add");
    registry.add(&agent("gone")).expect("add");
    registry
        .soft_delete("gone", 1_800_000_000_000)
        .expect("delete");

    let gone_marker = home.path().join("gone.started");
    let live_marker = home.path().join("live.started");

    let gone = workers(home.path(), &gone_marker);
    gone.start(&registry.get("gone").expect("registry").expect("gone"));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !gone_marker.exists(),
        "a worker in the trash must not start"
    );
    assert!(!gone.is_ready("gone"));
    gone.stop_all();

    let live = workers(home.path(), &live_marker);
    live.start(&registry.get("live").expect("registry").expect("live"));
    let mut started = false;
    for _ in 0..20 {
        if live_marker.exists() {
            started = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(started, "an Agent in use still starts");
    live.stop_all();
}
