//! Each Agent's own Egress (ADR 0029, issue #43), ported from
//! `packages/runtime-legacy/src/supervisor/egress/egress.ts`.
//!
//! The list lives in the Agent's row in `agents.json`. The old Machine-wide
//! `runtime/egress.json` is copied to every Agent once, then kept as the union
//! view a Controller that knows one list still reads.

use std::fs;

use tempfile::tempdir;
use veeloe_runtime_supervisor::agents::{Agent, AgentRegistry};
use veeloe_runtime_supervisor::egress::{is_valid_egress, load_egress, Egress};

fn domains(entries: &[&str]) -> Vec<String> {
    entries.iter().map(|entry| entry.to_string()).collect()
}

fn agent(id: &str) -> Agent {
    Agent {
        id: id.into(),
        name: id.into(),
        provider: "main".into(),
        model: "model-a".into(),
        character: None,
        allowlist: Vec::new(),
        egress: Vec::new(),
        approval_timeout_s: 3_600,
        budget: None,
        deleted_at: None,
    }
}

fn two_agents(home: &std::path::Path) -> AgentRegistry {
    let registry = AgentRegistry::open(home).expect("registry");
    registry.add(&agent("a1")).expect("a1");
    registry.add(&agent("a2")).expect("a2");
    registry
}

#[test]
fn no_file_lets_nothing_out() {
    let home = tempdir().expect("home");
    two_agents(home.path());
    assert!(load_egress(home.path()).expect("load").is_empty());
    let egress = Egress::open(home.path()).expect("open");
    assert!(egress.current("a1").is_empty());
    assert!(egress.current("a2").is_empty());
}

/// Issue #44: a permanent yes adds exactly one domain to exactly one Agent, and
/// the next read of `agents.json` already has it.
#[test]
fn a_permanent_yes_adds_one_domain_to_one_agent() {
    let home = tempdir().expect("home");
    let registry = two_agents(home.path());
    let egress = Egress::open(home.path()).expect("open");
    assert_eq!(
        egress.add_domain("a1", "example.com").expect("add"),
        Some(domains(&["example.com"]))
    );
    // The same domain twice is still one entry.
    assert_eq!(
        egress.add_domain("a1", "example.com").expect("add again"),
        Some(domains(&["example.com"]))
    );
    assert_eq!(egress.current("a1"), domains(&["example.com"]));
    assert!(egress.current("a2").is_empty());
    assert_eq!(
        registry.get("a1").expect("get").expect("a1").egress,
        domains(&["example.com"])
    );
    // An address is not a domain, and an unknown Agent is not written.
    assert_eq!(egress.add_domain("a1", "10.0.0.1").expect("bad"), None);
    assert_eq!(egress.add_domain("nobody", "example.org").expect("none"), None);
}

#[test]
fn each_agent_keeps_its_own_list() {
    let home = tempdir().expect("home");
    let registry = two_agents(home.path());
    let egress = Egress::open(home.path()).expect("open");
    let next = egress
        .set_agent(
            "a1",
            domains(&["api.anthropic.com", "github.com", "api.anthropic.com"]),
        )
        .expect("set")
        .expect("accepted");
    assert_eq!(next, domains(&["api.anthropic.com", "github.com"]));
    assert_eq!(
        egress.current("a1"),
        domains(&["api.anthropic.com", "github.com"])
    );
    // B gets nothing from A's list, in memory or on disk (ADR 0029).
    assert!(egress.current("a2").is_empty());
    assert!(registry.get("a2").expect("get").expect("a2").egress.is_empty());

    // The file is the source of truth, and `egress.json` is the union view.
    let reopened = Egress::open(home.path()).expect("reopen");
    assert_eq!(reopened.current("a1"), next);
    assert!(reopened.current("a2").is_empty());
    assert_eq!(
        load_egress(home.path()).expect("legacy union"),
        domains(&["api.anthropic.com", "github.com"])
    );
}

#[test]
fn a_list_the_protocol_refuses_is_not_kept() {
    let home = tempdir().expect("home");
    two_agents(home.path());
    let egress = Egress::open(home.path()).expect("open");
    assert!(egress
        .set_agent("a1", domains(&["not a domain"]))
        .expect("set")
        .is_none());
    assert!(egress.set_all(domains(&["not a domain"])).expect("set").is_none());
    assert!(egress.current("a1").is_empty());
    assert!(!is_valid_egress(&domains(&["localhost"])));
    assert!(is_valid_egress(&domains(&["*.example.com"])));
}

/// Without `agent`, the legacy request changes every Agent, as it did before
/// the split (issue #43).
#[test]
fn a_list_without_an_agent_reaches_every_agent_and_the_legacy_file() {
    let home = tempdir().expect("home");
    let registry = two_agents(home.path());
    let egress = Egress::open(home.path()).expect("open");
    let next = egress
        .set_all(domains(&["github.com", "*.npmjs.org"]))
        .expect("set")
        .expect("accepted");
    for id in ["a1", "a2"] {
        assert_eq!(egress.current(id), next);
        assert_eq!(
            registry.get(id).expect("get").expect("agent").egress,
            next
        );
    }
    assert_eq!(load_egress(home.path()).expect("legacy"), next);

    // A new Agent still starts empty: the legacy list is not remembered for ids
    // that do not exist yet (issue #43).
    registry.add(&agent("a3")).expect("a3");
    assert!(egress.current("a3").is_empty());
}

/// The Machine-wide list becomes every Agent's list, once, and a later start
/// never copies it again (ADR 0069, issue #43).
#[test]
fn the_old_machine_list_is_copied_to_every_agent_once() {
    let home = tempdir().expect("home");
    // A home from before this change: Agents with no `egress`, and one list for
    // the Machine.
    let registry = AgentRegistry::open(home.path()).expect("registry");
    registry.add(&agent("a1")).expect("a1");
    registry.add(&agent("a2")).expect("a2");
    let file = home.path().join("runtime/agents.json");
    let mut rows: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(&file).expect("agents.json")).expect("json");
    for row in &mut rows {
        row.as_object_mut().expect("row").remove("egress");
    }
    fs::write(&file, serde_json::to_string(&rows).expect("json")).expect("old agents.json");
    fs::write(
        home.path().join("runtime/egress.json"),
        r#"["github.com","*.npmjs.org"]"#,
    )
    .expect("old egress.json");

    let egress = Egress::open(home.path()).expect("open");
    for id in ["a1", "a2"] {
        assert_eq!(
            egress.current(id),
            domains(&["github.com", "*.npmjs.org"])
        );
    }
    assert!(
        home.path().join("runtime/egress.json.migrated").exists(),
        "the migration left no flag, so it runs again"
    );

    // A change made after the migration survives the next start.
    egress
        .set_agent("a1", domains(&["example.com"]))
        .expect("set")
        .expect("accepted");
    let reopened = Egress::open(home.path()).expect("reopen");
    assert_eq!(reopened.current("a1"), domains(&["example.com"]));
    assert_eq!(
        reopened.current("a2"),
        domains(&["github.com", "*.npmjs.org"])
    );
}

#[test]
fn a_file_that_is_not_a_list_opens_nothing() {
    let home = tempdir().expect("home");
    two_agents(home.path());
    fs::create_dir_all(home.path().join("runtime")).expect("runtime");
    fs::write(
        home.path().join("runtime/egress.json"),
        "{ \"not\": \"a list\" }",
    )
    .expect("write");
    let egress = Egress::open(home.path()).expect("open");
    assert!(egress.current("a1").is_empty());
    assert!(load_egress(home.path()).expect("load").is_empty());
}

/// Issue #43 review: a row this build cannot read is not an Agent it may
/// delete. The migration writes the whole file, so it must carry that row
/// through untouched; so must an ordinary write after it.
#[test]
fn a_row_this_build_cannot_read_survives_a_whole_file_write() {
    let home = tempdir().expect("home");
    let registry = two_agents(home.path());
    let file = home.path().join("runtime/agents.json");
    let mut rows: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(&file).expect("agents.json")).expect("json");
    // No `provider` and no `model`: another Runtime's row, which this build's
    // `Agent` cannot parse.
    let future = serde_json::json!({ "id": "future", "name": "From another Runtime" });
    rows.push(future.clone());
    fs::write(&file, serde_json::to_string(&rows).expect("json")).expect("agents.json");
    fs::write(
        home.path().join("runtime/egress.json"),
        r#"["github.com"]"#,
    )
    .expect("old egress.json");

    // The migration copies the old list to every Agent it understands.
    let egress = Egress::open(home.path()).expect("open");
    assert_eq!(egress.current("a1"), domains(&["github.com"]));
    assert_eq!(egress.current("a2"), domains(&["github.com"]));
    assert!(egress.current("future").is_empty());

    let after: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(&file).expect("agents.json")).expect("json");
    assert_eq!(after.len(), 3, "the migration deleted a row: {after:?}");
    assert!(
        after.iter().any(|row| *row == future),
        "the row this build cannot read was rewritten: {after:?}"
    );

    // Any later write of the whole file keeps it too, so creating an Agent
    // does not lose the other version's row either.
    registry.add(&agent("a3")).expect("a3");
    let after: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(&file).expect("agents.json")).expect("json");
    assert_eq!(after.len(), 4, "a write deleted a row: {after:?}");
    assert!(after.iter().any(|row| *row == future), "{after:?}");
}
