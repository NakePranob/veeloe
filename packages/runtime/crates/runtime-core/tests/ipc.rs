//! The IPC wire format, held to the shape `packages/runtime-legacy/src/ipc.ts`
//! sends, so a worker and a supervisor can still be mixed while the port lands.

use serde_json::{json, Value};
use veeloe_runtime_core::{ApprovalDecision, FromWorker, ToWorker};

fn same(left: &str, right: &Value) {
    let left: Value = serde_json::from_str(left).expect("left");
    assert_eq!(&left, right);
}

#[test]
fn a_members_message_is_read_and_written_as_the_legacy_line() {
    let line = r#"{"kind":"message","task":"t1","id":"m1","member":"m_owner","text":"hi","ref":"sig-m1"}"#;
    let message: ToWorker = serde_json::from_str(line).expect("message");
    assert_eq!(
        message,
        ToWorker::Message {
            task: "t1".into(),
            id: "m1".into(),
            member: "m_owner".into(),
            text: "hi".into(),
            reference: "sig-m1".into(),
        }
    );
    same(&serde_json::to_string(&message).expect("json"), &serde_json::from_str(line).expect("line"));
}

#[test]
fn an_agent_update_leaves_out_what_it_does_not_carry() {
    let line = r#"{"kind":"agent","name":"Builder"}"#;
    let message: ToWorker = serde_json::from_str(line).expect("agent");
    assert_eq!(
        message,
        ToWorker::Agent {
            name: "Builder".into(),
            allowlist: None,
            approval_timeout_s: None,
        }
    );
    same(&serde_json::to_string(&message).expect("json"), &serde_json::from_str(line).expect("line"));
}

#[test]
fn an_approval_answer_names_its_decision_and_task() {
    let line = r#"{"kind":"approval","request":"ap_1","decision":"redirect","message":"use ls","member":"m_owner","ref":"sig","task":"t1"}"#;
    let message: ToWorker = serde_json::from_str(line).expect("approval");
    assert_eq!(
        message,
        ToWorker::Approval {
            request: "ap_1".into(),
            decision: ApprovalDecision::Redirect,
            message: Some("use ls".into()),
            member: "m_owner".into(),
            reference: "sig".into(),
            task: Some("t1".into()),
        }
    );
    same(&serde_json::to_string(&message).expect("json"), &serde_json::from_str(line).expect("line"));
}

#[test]
fn an_llm_request_carries_its_headers_as_an_object() {
    let line = json!({
        "kind": "llm.request",
        "id": "1",
        "method": "POST",
        "path": "/v1/messages",
        "headers": { "content-type": "application/json", "x-veeloe-task": "t1" },
        "body": "{}",
    })
    .to_string();
    let message: FromWorker = serde_json::from_str(&line).expect("request");
    let FromWorker::LlmRequest { headers, .. } = &message else {
        panic!("not an llm request");
    };
    assert_eq!(
        veeloe_runtime_core::header(headers, "x-veeloe-task"),
        Some("t1")
    );
}

#[test]
fn an_llm_answer_carries_its_headers_as_an_object() {
    let line = json!({
        "kind": "llm.response",
        "id": "1",
        "status": 429,
        "headers": { "x-veeloe-error": "budget.exhausted" },
        "body": "{}",
    })
    .to_string();
    let message: ToWorker = serde_json::from_str(&line).expect("answer");
    let ToWorker::LlmResponse {
        status, headers, ..
    } = message
    else {
        panic!("not an llm answer");
    };
    assert_eq!(status, 429);
    assert_eq!(
        veeloe_runtime_core::header(&headers, "x-veeloe-error"),
        Some("budget.exhausted")
    );
}

#[test]
fn a_ready_worker_and_an_error_keep_their_kinds() {
    assert_eq!(
        serde_json::to_value(FromWorker::Ready).expect("json"),
        json!({ "kind": "ready" })
    );
    let error = FromWorker::Error {
        member: "m_owner".into(),
        reference: "sig".into(),
        code: "agent.busy".into(),
        task: None,
    };
    assert_eq!(
        serde_json::to_value(&error).expect("json"),
        json!({ "kind": "error", "member": "m_owner", "ref": "sig", "code": "agent.busy" })
    );
}
