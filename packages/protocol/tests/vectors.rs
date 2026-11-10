use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde_json::Value;
use veeloe_protocol::{verify, MemorySeenSequences, Route, SeenSequences};

fn vectors_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("vectors/envelopes.json")
}

#[test]
fn every_envelope_vector_reaches_its_expected_result() {
    let text = fs::read_to_string(vectors_path()).expect("read envelopes.json");
    let doc: Value = serde_json::from_str(&text).expect("parse envelopes.json");

    let trusted: HashSet<String> = doc["trusted"]
        .as_array()
        .expect("trusted")
        .iter()
        .map(|key| key.as_str().expect("key").to_string())
        .collect();
    let destinations: Vec<String> = doc["self"]["destinations"]
        .as_array()
        .expect("destinations")
        .iter()
        .map(|destination| destination.as_str().expect("destination").to_string())
        .collect();
    let member = doc["self"]["member"]
        .as_str()
        .expect("member")
        .to_string();
    let is_for_me = |route: &Route| match route {
        Route::To(to) => destinations.iter().any(|destination| destination == to),
        Route::Recipients(recipients) => recipients.iter().any(|recipient| recipient == &member),
    };

    let vectors = doc["vectors"].as_array().expect("vectors");
    assert!(!vectors.is_empty(), "the vector file has no cases");

    for vector in vectors {
        let name = vector["name"].as_str().expect("name");
        let mut seen = MemorySeenSequences::default();
        if let Some(entries) = vector["seen"].as_object() {
            for (sender, seq) in entries {
                seen.record(sender, seq.as_u64().expect("sequence"));
            }
        }

        let frame: Value =
            serde_json::from_str(vector["frame"].as_str().expect("frame")).expect("frame is JSON");

        let got = match verify(&frame, &trusted, is_for_me, &mut seen) {
            Ok(_) => "ok".to_string(),
            Err(reason) => reason.to_string(),
        };
        assert_eq!(got, vector["expect"].as_str().expect("expect"), "{name}");
    }
}

#[test]
fn a_sequence_only_moves_after_every_check_passes() {
    let text = fs::read_to_string(vectors_path()).expect("read envelopes.json");
    let doc: Value = serde_json::from_str(&text).expect("parse envelopes.json");
    let trusted: HashSet<String> = doc["trusted"]
        .as_array()
        .expect("trusted")
        .iter()
        .map(|key| key.as_str().expect("key").to_string())
        .collect();
    let is_for_me = |route: &Route| matches!(route, Route::To(to) if to == "agent-1");

    let valid = doc["vectors"]
        .as_array()
        .expect("vectors")
        .iter()
        .find(|vector| vector["expect"] == "ok")
        .expect("a valid vector");
    let frame: Value =
        serde_json::from_str(valid["frame"].as_str().expect("frame")).expect("frame is JSON");
    let sender = frame["from"].as_str().expect("from").to_string();
    let seq = serde_json::from_str::<Value>(frame["signed"].as_str().expect("signed"))
        .expect("signed is JSON")["seq"]
        .as_u64()
        .expect("seq");

    let mut seen = MemorySeenSequences::default();
    assert!(verify(&frame, &trusted, is_for_me, &mut seen).is_ok());
    assert_eq!(seen.last(&sender), Some(seq));

    assert_eq!(
        verify(&frame, &trusted, is_for_me, &mut seen)
            .expect_err("a replay")
            .to_string(),
        "replayed"
    );
    assert_eq!(seen.last(&sender), Some(seq));
}
