use std::fs;
use std::path::Path;

use serde_json::Value;
use veeloe_protocol::messages::message_is_valid;

#[test]
fn every_message_vector_is_read_as_expected() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vectors/messages.json");
    let text = fs::read_to_string(path).expect("read messages.json");
    let doc: Value = serde_json::from_str(&text).expect("parse messages.json");

    for vector in doc["vectors"].as_array().expect("vectors") {
        let type_ = vector["type"].as_str().expect("type");
        let valid = vector["valid"].as_bool().expect("valid");
        let got = message_is_valid(type_, &vector["body"])
            .unwrap_or_else(|| panic!("unknown message type in vectors: {type_}"));
        assert_eq!(
            got,
            valid,
            "{} ({type_})",
            vector["name"].as_str().unwrap_or("")
        );
    }
}
