use std::fs;
use std::path::Path;

use serde_json::{Map, Value};
use veeloe_protocol::certificate::{revoked_with, sign_certificate, verify_certificate};

fn vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vectors")
        .join(name);
    let text = fs::read_to_string(path).expect("read vector file");
    serde_json::from_str(&text).expect("parse vector file")
}

#[test]
fn certificate_vectors_match_the_shared_contract() {
    let doc = vectors("certificates.json");
    for vector in doc["vectors"].as_array().expect("vectors") {
        assert_eq!(
            verify_certificate(&vector["certificate"]).is_some(),
            vector["valid"].as_bool().expect("valid"),
            "{}",
            vector["name"].as_str().unwrap_or("")
        );
    }

    let fallout = &doc["fallout"];
    let revoked = fallout["revoked"].as_str().expect("revoked");
    let links: Vec<(String, String)> = fallout["links"]
        .as_array()
        .expect("links")
        .iter()
        .map(|link| {
            (
                link["key"].as_str().expect("key").to_string(),
                link["by"].as_str().expect("by").to_string(),
            )
        })
        .collect();
    let keep: Vec<String> = fallout["keep"]
        .as_array()
        .expect("keep")
        .iter()
        .map(|key| key.as_str().expect("keep").to_string())
        .collect();
    let drops: Vec<String> = fallout["drops"]
        .as_array()
        .expect("drops")
        .iter()
        .map(|key| key.as_str().expect("drop").to_string())
        .collect();

    assert_eq!(revoked_with(revoked, &links, &keep), drops);
}

#[test]
fn signing_a_certificate_round_trips() {
    let mut body = Map::new();
    body.insert("workspace".into(), Value::String("w_vector".into()));
    body.insert("member".into(), Value::String("m_vector".into()));
    body.insert("at".into(), Value::from(1_800_000_000_000u64));
    body.insert("type".into(), Value::String("device.link".into()));
    body.insert(
        "key".into(),
        Value::String("NLTZBDFWy23PC-sKKUm3VZyUDSvLbb6MU6mzAnjjp0Y".into()),
    );
    body.insert("name".into(), Value::String("Chrome บน Mac".into()));

    let certificate = sign_certificate(&body, &[0x44; 32]);
    let verified = verify_certificate(&certificate).expect("verify signed certificate");
    assert_eq!(verified["workspace"], "w_vector");
    assert_eq!(verified["name"], "Chrome บน Mac");
}
