//! The Provider and model a Task is pinned to, ported from
//! `packages/runtime-legacy/src/supervisor/proxy/task-routes.ts`.

use tempfile::tempdir;
use veeloe_runtime_supervisor::agents::Agent;
use veeloe_runtime_supervisor::providers::{Auth, Provider};
use veeloe_runtime_supervisor::task_routes::TaskRoutes;

fn agent(provider: &str, model: &str) -> Agent {
    Agent {
        id: "a1".into(),
        name: "Deployer".into(),
        provider: provider.into(),
        model: model.into(),
        character: None,
        allowlist: Vec::new(),
        egress: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
    }
}

fn provider(name: &str) -> Provider {
    Provider {
        name: name.into(),
        url: format!("http://{name}.test"),
        key: format!("key-{name}"),
        auth: Auth::ApiKey,
        preset: None,
    }
}

#[test]
fn a_task_keeps_the_provider_and_model_it_started_on() {
    let home = tempdir().expect("home");
    let routes = TaskRoutes::open(home.path()).expect("routes");
    let main = provider("main");
    let second = provider("second");

    let first = routes
        .route(&agent("main", "model-a"), Some("task-1"), &[main.clone()])
        .expect("route");
    assert_eq!(
        (first.0.name.as_str(), first.1.as_str()),
        ("main", "model-a")
    );

    // The Agent moves; the Task that already ran does not.
    let updated = agent("second", "model-b");
    let kept = routes
        .route(&updated, Some("task-1"), &[main.clone(), second.clone()])
        .expect("route");
    assert_eq!((kept.0.name.as_str(), kept.1.as_str()), ("main", "model-a"));

    // A new Task starts on the Agent's current Provider and model.
    let next = routes
        .route(&updated, Some("task-2"), &[main.clone(), second.clone()])
        .expect("route");
    assert_eq!(
        (next.0.name.as_str(), next.1.as_str()),
        ("second", "model-b")
    );

    // A request with no Task pins nothing and takes the current values.
    let none = routes
        .route(&updated, None, &[main, second])
        .expect("route");
    assert_eq!(
        (none.0.name.as_str(), none.1.as_str()),
        ("second", "model-b")
    );
}

#[test]
fn a_pin_survives_a_restart_and_moves_when_its_provider_is_gone() {
    let home = tempdir().expect("home");
    let main = provider("main");
    let second = provider("second");
    {
        let routes = TaskRoutes::open(home.path()).expect("routes");
        routes
            .route(&agent("main", "model-a"), Some("task-1"), &[main.clone()])
            .expect("route");
    }

    let routes = TaskRoutes::open(home.path()).expect("reopen");
    let kept = routes
        .route(
            &agent("second", "model-b"),
            Some("task-1"),
            &[main.clone(), second.clone()],
        )
        .expect("route");
    assert_eq!((kept.0.name.as_str(), kept.1.as_str()), ("main", "model-a"));

    // The pinned Provider goes, so the Task moves to the Agent's current one.
    let moved = routes
        .route(
            &agent("second", "model-b"),
            Some("task-1"),
            &[second.clone()],
        )
        .expect("route");
    assert_eq!(
        (moved.0.name.as_str(), moved.1.as_str()),
        ("second", "model-b")
    );
    let again = routes
        .route(&agent("main", "model-a"), Some("task-1"), &[second])
        .expect("route");
    assert_eq!(
        (again.0.name.as_str(), again.1.as_str()),
        ("second", "model-b")
    );
}

#[test]
fn an_agent_with_no_provider_has_no_route() {
    let home = tempdir().expect("home");
    let routes = TaskRoutes::open(home.path()).expect("routes");
    assert!(routes
        .route(&agent("main", "model-a"), Some("task-1"), &[])
        .is_none());
}

#[test]
fn pruning_drops_the_tasks_of_agents_this_machine_no_longer_has() {
    let home = tempdir().expect("home");
    let main = provider("main");
    {
        let routes = TaskRoutes::open(home.path()).expect("routes");
        routes
            .route(&agent("main", "model-a"), Some("task-1"), &[main.clone()])
            .expect("route");
    }
    let routes = TaskRoutes::open(home.path()).expect("reopen");
    routes.prune(&[]).expect("prune");
    let kept = routes
        .route(&agent("main", "model-b"), Some("task-1"), &[main])
        .expect("route");
    // The line was dropped, so the Task is pinned again from the Agent.
    assert_eq!(kept.1, "model-b");
}
