//! The Machine's Egress, ported from
//! `packages/runtime-legacy/src/supervisor/egress/egress.ts`.

use std::fs;

use tempfile::tempdir;
use veeloe_runtime_supervisor::egress::{is_valid_egress, load_egress, Egress};

fn domains(entries: &[&str]) -> Vec<String> {
    entries.iter().map(|entry| entry.to_string()).collect()
}

#[test]
fn no_file_lets_nothing_out() {
    let home = tempdir().expect("home");
    assert!(load_egress(home.path()).expect("load").is_empty());
    assert!(Egress::open(home.path()).expect("open").current().is_empty());
}

#[test]
fn a_saved_list_is_read_back_in_order_and_duplicates_are_dropped() {
    let home = tempdir().expect("home");
    let egress = Egress::open(home.path()).expect("open");
    let next = egress
        .set(domains(&["api.anthropic.com", "github.com", "api.anthropic.com"]))
        .expect("set")
        .expect("accepted");
    assert_eq!(next, domains(&["api.anthropic.com", "github.com"]));
    assert_eq!(
        load_egress(home.path()).expect("load"),
        domains(&["api.anthropic.com", "github.com"])
    );
    assert_eq!(egress.current(), next);
}

#[test]
fn a_list_the_protocol_refuses_is_not_kept() {
    let home = tempdir().expect("home");
    let egress = Egress::open(home.path()).expect("open");
    assert!(egress
        .set(domains(&["not a domain"]))
        .expect("set")
        .is_none());
    assert!(egress.current().is_empty());
    assert!(!is_valid_egress(&domains(&["localhost"])));
    assert!(is_valid_egress(&domains(&["*.example.com"])));
}

#[test]
fn a_file_that_is_not_a_list_opens_nothing() {
    let home = tempdir().expect("home");
    fs::create_dir_all(home.path().join("runtime")).expect("runtime");
    fs::write(
        home.path().join("runtime/egress.json"),
        "{ \"not\": \"a list\" }",
    )
    .expect("write");
    assert!(load_egress(home.path()).expect("load").is_empty());
}
