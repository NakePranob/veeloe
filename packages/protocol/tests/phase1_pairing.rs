use std::fs;
use std::path::Path;

use serde_json::Value;
use veeloe_protocol::linking::{
    build_linking_link, link_request_proof, link_request_proof_text, linking_proof,
    linking_proof_text, parse_linking_link,
};
use veeloe_protocol::pairing::{
    build_pairing_link, check_pairing_request, pairing_link_bytes, pairing_proof,
    pairing_proof_text, pairing_request_bytes, parse_pairing_link,
};

fn vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vectors")
        .join(name);
    let text = fs::read_to_string(path).expect("read vector file");
    serde_json::from_str(&text).expect("parse vector file")
}

#[test]
fn pairing_vectors_match_the_shared_contract() {
    let doc = vectors("pairings.json");
    let hub = doc["hubUrl"].as_str().expect("hubUrl");
    let now = doc["now"].as_u64().expect("now");
    let expires = doc["expires"].as_u64().expect("expires");
    let link_text = doc["link"].as_str().expect("link");
    let secret = doc["secret"].as_str().expect("secret");
    let member = doc["member"].as_str().expect("member");

    let link = parse_pairing_link(link_text, now * 1000).expect("parse link");
    assert_eq!(link.hub, hub);
    assert_eq!(link.secret, secret);
    assert_eq!(link.expires, expires);

    let built = build_pairing_link(hub, &[0x33; 32], &[0x55; 32], expires).expect("build link");
    assert_eq!(built, link_text);

    let signed_text = String::from_utf8(
        pairing_link_bytes(&link.hub, &link.machine, link.expires).expect("link bytes"),
    )
    .unwrap();
    assert_eq!(signed_text, doc["linkSignedText"].as_str().unwrap());

    let claim: Value = serde_json::from_str(doc["claim"].as_str().unwrap()).unwrap();
    let controller = claim["from"].as_str().unwrap();
    let request_text = String::from_utf8(
        pairing_request_bytes(&link.hub, &link.machine, controller, link.expires)
            .expect("request bytes"),
    )
    .unwrap();
    assert_eq!(request_text, doc["requestSignedText"].as_str().unwrap());

    assert_eq!(
        pairing_proof_text(&link.machine, controller, member),
        doc["proofText"].as_str().unwrap()
    );
    assert_eq!(
        pairing_proof(secret, &link.machine, controller, member).unwrap(),
        doc["proof"].as_str().unwrap()
    );

    for vector in doc["requests"].as_array().unwrap() {
        assert_eq!(
            check_pairing_request(&vector["request"], hub),
            vector["valid"].as_bool().unwrap(),
            "{}",
            vector["name"].as_str().unwrap_or("")
        );
    }
}

#[test]
fn linking_vectors_match_the_shared_contract() {
    let doc = vectors("linkings.json");
    let link_text = doc["link"].as_str().expect("link");
    let link = parse_linking_link(link_text, 0).expect("parse link");

    assert_eq!(link.to, doc["to"].as_str().unwrap());
    assert_eq!(link.id, doc["id"].as_str().unwrap());
    assert_eq!(link.secret, doc["secret"].as_str().unwrap());

    let built = build_linking_link(&link.hub, &link.to, &link.id, &[0x55; 32], link.expires)
        .expect("build link");
    assert_eq!(built, link_text);

    let request = &doc["request"];
    let key = request["key"].as_str().unwrap();
    let name = request["name"].as_str().unwrap();
    assert_eq!(
        link_request_proof_text(&link.id, key, name),
        doc["requestProofText"].as_str().unwrap()
    );
    assert_eq!(
        link_request_proof(&link.secret, &link.id, key, name).unwrap(),
        request["proof"].as_str().unwrap()
    );

    let data = doc["data"].as_str().unwrap();
    assert_eq!(
        linking_proof_text(key, data),
        doc["proofText"].as_str().unwrap()
    );
    assert_eq!(
        linking_proof(&link.secret, key, data).unwrap(),
        doc["proof"].as_str().unwrap()
    );
}

/// What a handoff must hold once its proof checked out, as `HandoffDataSchema`
/// reads it: a workspace, a Member, Machines with their Hub, and other keys.
#[test]
fn a_handoff_carries_the_places_and_the_keys() {
    use serde_json::json;
    use veeloe_protocol::linking::is_handoff_data;

    let good = json!({
        "workspace": "w_1",
        "member": "m_1",
        "machines": [{"id": "machine-1", "key": "mk", "name": "mac", "hub": "wss://hub.example.com"}],
        "keys": [{"key": "k2", "name": "Chrome"}, {"key": "k3"}],
        "extra": true
    });
    assert!(is_handoff_data(&good));

    for broken in [
        json!({"member": "m_1", "machines": [], "keys": []}),
        json!({"workspace": "", "member": "m_1", "machines": [], "keys": []}),
        json!({"workspace": "w", "member": "m_1", "keys": []}),
        json!({"workspace": "w", "member": "m_1", "machines": [{"id": "1"}], "keys": []}),
        json!({"workspace": "w", "member": "m_1", "machines": [], "keys": [{"name": "no key"}]}),
        json!({"workspace": "w", "member": "m_1", "machines": [], "keys": [{"key": "k", "name": "x".repeat(81)}]}),
        json!("not an object"),
    ] {
        assert!(!is_handoff_data(&broken), "should be refused: {broken}");
    }
}
