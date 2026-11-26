use std::collections::HashSet;
use std::fs;
use std::path::Path;

use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use veeloe_protocol::base64url::from_base64url;
use veeloe_protocol::frame::{parse_frame, Frame};
use veeloe_protocol::hub_auth::{handshake_bytes, normalize_hub_url};
use veeloe_protocol::signer::{Outgoing, Signer};
use veeloe_protocol::{verify, MemorySeenSequences};

fn vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vectors")
        .join(name);
    let text = fs::read_to_string(path).expect("read vector file");
    serde_json::from_str(&text).expect("parse vector file")
}

#[test]
fn hub_urls_match_the_shared_vectors() {
    let doc = vectors("hub-urls.json");
    for vector in doc["vectors"].as_array().expect("vectors") {
        let input = vector["input"].as_str().expect("input");
        match normalize_hub_url(input) {
            Ok(normalized) => assert_eq!(
                normalized,
                vector["normalized"].as_str().expect("normalized"),
                "{input}"
            ),
            Err(_) => assert_eq!(
                vector["error"].as_bool(),
                Some(true),
                "{input} should normalize"
            ),
        }
    }
}

#[test]
fn handshake_vectors_verify_with_the_same_bytes() {
    let doc = vectors("handshakes.json");
    let hub_url = doc["hubUrl"].as_str().expect("hubUrl");
    let nonce = doc["nonce"].as_str().expect("nonce");
    let signed_text = doc["signedText"].as_str().expect("signedText");

    assert_eq!(
        String::from_utf8(handshake_bytes(hub_url, nonce).expect("handshake bytes")).unwrap(),
        signed_text
    );

    for vector in doc["vectors"].as_array().expect("vectors") {
        let answer: Value =
            serde_json::from_str(vector["frame"].as_str().expect("frame")).expect("frame JSON");
        let key = from_base64url(answer["key"].as_str().expect("key")).expect("key base64url");
        let signature =
            from_base64url(answer["sig"].as_str().expect("sig")).expect("sig base64url");
        let key: [u8; 32] = key.try_into().expect("32-byte key");
        let verifying_key = VerifyingKey::from_bytes(&key).expect("verifying key");
        let signature = Signature::from_slice(&signature).expect("signature");
        let valid = verifying_key
            .verify_strict(&handshake_bytes(hub_url, nonce).expect("bytes"), &signature)
            .is_ok();
        assert_eq!(
            valid,
            vector["valid"].as_bool().expect("valid"),
            "{}",
            vector["name"].as_str().unwrap_or("")
        );
    }

    for frame in doc["ready"].as_array().expect("ready") {
        assert!(matches!(
            parse_frame(frame.as_str().expect("ready frame")),
            Frame::Known { .. }
        ));
    }
    assert!(matches!(
        parse_frame(doc["error"].as_str().expect("error frame")),
        Frame::Known { .. }
    ));
}

#[test]
fn signer_writes_the_same_signed_bytes_and_verifies() {
    let signer = Signer::new(&[0x11; 32]);
    let envelope = signer.sign(
        Outgoing {
            type_: "task.message".into(),
            to: Some("agent-1".into()),
            recipients: None,
            task: Some("task-1".into()),
            member: Some("member-1".into()),
            body: json!({ "text": "hi" }),
        },
        8,
    );

    assert_eq!(
        envelope.signed,
        r#"{"type":"task.message","to":"agent-1","task":"task-1","member":"member-1","seq":8,"body":{"text":"hi"}}"#
    );

    let value = serde_json::to_value(&envelope).expect("envelope JSON");
    let trusted: HashSet<String> = HashSet::from([envelope.from.clone()]);
    let mut seen = MemorySeenSequences::default();
    let verified = verify(&value, &trusted, |_| true, &mut seen).expect("verify signed envelope");
    assert_eq!(verified.signed.seq, 8);
    assert_eq!(verified.signed.body, json!({ "text": "hi" }));
}

#[test]
fn frame_parsing_skips_unknown_types_and_rejects_bad_known_frames() {
    assert!(matches!(
        parse_frame(r#"{"type":"future.type","body":{}}"#),
        Frame::Unknown { type_ } if type_ == "future.type"
    ));
    assert_eq!(parse_frame(r#"{"junk":true}"#), Frame::Invalid);
    assert_eq!(
        parse_frame(r#"{"type":"hub.ready","machine":"m","member":"n"}"#),
        Frame::Invalid
    );
    assert!(matches!(
        parse_frame(r#"{"type":"hub.ready","machine":"m"}"#),
        Frame::Known { .. }
    ));
}
