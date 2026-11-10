//! The LLM adapter and the tool loop through it, ported from
//! `packages/runtime-legacy/src/llm-seam.test.ts` and
//! `packages/runtime-legacy/src/worker/adapters/anthropic-llm.ts`.
//!
//! The transport is faked: what is under test is the request the worker builds,
//! the answer it reads (JSON or stream), and the codes it reports.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{json, Value};
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRegistry, ToolRunner};
use veeloe_runtime_core::{
    usage_in, AgentCore, EventStore, FromWorker, Llm, LlmError, LlmHttpRequest, LlmHttpResponse,
    LlmRequest, SupervisorLink, ToWorker,
};
use veeloe_runtime_worker::llm::{AnthropicLlm, LlmTransport};

struct FakeTransport {
    answers: Mutex<VecDeque<Result<LlmHttpResponse, LlmError>>>,
    requests: Mutex<Vec<LlmHttpRequest>>,
}

impl FakeTransport {
    fn with(answers: Vec<Result<LlmHttpResponse, LlmError>>) -> Self {
        Self {
            answers: Mutex::new(answers.into()),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<LlmHttpRequest> {
        self.requests.lock().expect("requests").clone()
    }
}

#[async_trait]
impl LlmTransport for FakeTransport {
    async fn call(
        &self,
        request: LlmHttpRequest,
        _cancel: &Cancel,
    ) -> Result<LlmHttpResponse, LlmError> {
        self.requests.lock().expect("requests").push(request);
        self.answers
            .lock()
            .expect("answers")
            .pop_front()
            .unwrap_or_else(|| Ok(json_answer(json!({ "content": [], "stop_reason": "end_turn" }))))
    }
}

fn json_answer(body: Value) -> LlmHttpResponse {
    LlmHttpResponse {
        status: 200,
        headers: vec![("content-type".into(), "application/json".into())],
        body: body.to_string(),
    }
}

fn request() -> LlmRequest {
    LlmRequest {
        task: "t1".into(),
        system: "You are Deployer".into(),
        messages: vec![veeloe_runtime_core::LlmMessage {
            role: "user".into(),
            content: vec![json!({ "type": "text", "text": "hi" })],
        }],
        tools: vec![ToolDefinition {
            name: "echo".into(),
            description: "echo".into(),
            input_schema: json!({ "type": "object" }),
        }],
    }
}

fn send(llm: &AnthropicLlm, request: LlmRequest) -> Result<veeloe_runtime_core::LlmReply, LlmError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(llm.send(request, &Cancel::new()))
}

#[test]
fn the_request_names_the_task_and_asks_for_the_agent_model_and_ceiling() {
    let transport = Arc::new(FakeTransport::with(vec![Ok(json_answer(
        json!({ "content": [{ "type": "text", "text": "hi" }], "stop_reason": "end_turn" }),
    ))]));
    let llm = AnthropicLlm::new(Arc::clone(&transport) as Arc<dyn LlmTransport>);
    let reply = send(&llm, request()).expect("reply");
    assert_eq!(reply.stop_reason.as_deref(), Some("end_turn"));

    let sent = transport.requests();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(sent[0].path, "/v1/messages");
    assert_eq!(
        veeloe_runtime_core::header(&sent[0].headers, "x-veeloe-task"),
        Some("t1")
    );
    let body: Value = serde_json::from_str(&sent[0].body).expect("json");
    assert_eq!(body["model"], "agent");
    assert_eq!(body["max_tokens"], 8192);
    assert_eq!(body["system"], "You are Deployer");
    assert_eq!(body["tools"][0]["name"], "echo");
    assert_eq!(body["messages"][0]["role"], "user");
}

#[test]
fn a_stream_is_read_whole_into_the_finished_message() {
    let stream = [
        "event: message_start",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10}}}",
        "",
        "event: content_block_start",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
        "",
        "event: content_block_delta",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}",
        "",
        "event: content_block_delta",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}",
        "",
        "event: content_block_start",
        "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tu1\",\"name\":\"echo\",\"input\":{}}}",
        "",
        "event: content_block_delta",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"a\\\":\"}}",
        "",
        "event: content_block_delta",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"1}\"}}",
        "",
        "event: message_delta",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":5}}",
        "",
    ]
    .join("\n");
    let transport = Arc::new(FakeTransport::with(vec![Ok(LlmHttpResponse {
        status: 200,
        headers: vec![("content-type".into(), "text/event-stream".into())],
        body: stream,
    })]));
    let llm = AnthropicLlm::new(Arc::clone(&transport) as Arc<dyn LlmTransport>);
    let reply = send(&llm, request()).expect("reply");

    assert_eq!(reply.stop_reason.as_deref(), Some("tool_use"));
    assert_eq!(reply.content.len(), 2);
    assert_eq!(reply.content[0]["text"], "Hello");
    assert_eq!(reply.content[1]["type"], "tool_use");
    assert_eq!(reply.content[1]["input"], json!({ "a": 1 }));
}

#[test]
fn a_refusal_from_the_supervisor_carries_its_own_code() {
    let transport = Arc::new(FakeTransport::with(vec![Ok(LlmHttpResponse {
        status: 429,
        headers: vec![("x-veeloe-error".into(), "budget.exhausted".into())],
        body: "{}".into(),
    })]));
    let llm = AnthropicLlm::new(Arc::clone(&transport) as Arc<dyn LlmTransport>);
    assert_eq!(
        send(&llm, request()).unwrap_err(),
        LlmError::Failed("budget.exhausted".into())
    );
}

#[test]
fn an_unreachable_supervisor_is_provider_unreachable() {
    let transport = Arc::new(FakeTransport::with(vec![Err(LlmError::Failed(
        "provider.unreachable".into(),
    ))]));
    let llm = AnthropicLlm::new(Arc::clone(&transport) as Arc<dyn LlmTransport>);
    assert_eq!(
        send(&llm, request()).unwrap_err(),
        LlmError::Failed("provider.unreachable".into())
    );
}

#[test]
fn a_cancelled_wait_is_turn_stopped_not_a_provider_problem() {
    struct Waits;
    #[async_trait]
    impl LlmTransport for Waits {
        async fn call(
            &self,
            _request: LlmHttpRequest,
            cancel: &Cancel,
        ) -> Result<LlmHttpResponse, LlmError> {
            cancel.cancelled().await;
            Err(LlmError::Failed("provider.failed".into()))
        }
    }
    let llm = AnthropicLlm::new(Arc::new(Waits) as Arc<dyn LlmTransport>);
    let cancel = Cancel::new();
    cancel.cancel();
    let error = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(llm.send(request(), &cancel))
        .unwrap_err();
    assert_eq!(error, LlmError::Failed("turn.stopped".into()));
}

#[test]
fn the_tokens_of_a_whole_answer_are_counted_from_json_or_a_stream() {
    assert_eq!(
        usage_in(
            &json!({ "usage": { "input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 2 } })
                .to_string()
        ),
        Some(17)
    );
    // A negative count cannot take tokens away.
    assert_eq!(
        usage_in(&json!({ "usage": { "input_tokens": -3, "output_tokens": 4 } }).to_string()),
        Some(4)
    );
    // An answer that says nothing of usage is not counted at all.
    assert_eq!(usage_in(&json!({ "content": [] }).to_string()), None);
    // In a stream, the last value each field carries wins.
    let stream = [
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":9}}",
    ]
    .join("\n");
    assert_eq!(usage_in(&stream), Some(19));
}

// ---------------------------------------------------------------- the tool loop

struct Echo;

#[async_trait]
impl ToolRunner for Echo {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "echo".into(),
            description: "echo".into(),
            input_schema: json!({ "type": "object" }),
        }]
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        if name != "echo" {
            return Err(ToolError::Unknown(name.into()));
        }
        Ok(input.to_string())
    }
}

#[derive(Default)]
struct RecordingLink {
    sent: Mutex<Vec<FromWorker>>,
}

impl SupervisorLink for RecordingLink {
    fn send(&self, message: FromWorker) {
        self.sent.lock().expect("sent").push(message);
    }
}

#[tokio::test]
async fn a_turn_runs_the_tool_loop_through_the_llm_adapter_and_ends_with_done() {
    let transport = Arc::new(FakeTransport::with(vec![
        Ok(json_answer(json!({
            "content": [{ "type": "tool_use", "id": "tu1", "name": "echo", "input": { "a": 1 } }],
            "stop_reason": "tool_use",
        }))),
        Ok(json_answer(json!({
            "content": [{ "type": "text", "text": "done" }],
            "stop_reason": "end_turn",
        }))),
    ]));
    let dir = tempfile::tempdir().expect("tempdir");
    let store = EventStore::open(dir.path().join("tasks.db")).expect("store");
    let mut tools = ToolRegistry::default();
    tools.register(Arc::new(Echo)).expect("tool");
    let link = Arc::new(RecordingLink::default());
    let agent = AgentCore::new(
        "Deployer",
        store,
        Arc::new(AnthropicLlm::new(
            Arc::clone(&transport) as Arc<dyn LlmTransport>
        )) as Arc<dyn Llm>,
        tools,
        Arc::clone(&link) as Arc<dyn SupervisorLink>,
    );
    // `echo` is not a file tool, so it needs the Allowlist to run without asking.
    agent.set_allowlist(vec!["echo".into()]);

    agent
        .receive(ToWorker::Message {
            task: "t1".into(),
            id: "m1".into(),
            member: "m_owner".into(),
            text: "go".into(),
            reference: "sig".into(),
        })
        .expect("receive");
    agent.idle().await;

    let kinds: Vec<String> = agent
        .events("t1")
        .expect("events")
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            "member.message",
            "turn.started",
            "llm.message",
            "tool.result",
            "llm.message",
            "turn.ended",
        ]
    );
    let requests = transport.requests();
    assert_eq!(requests.len(), 2);
    // The tool result goes back in the second request, as the Messages API wants it.
    let body: Value = serde_json::from_str(&requests[1].body).expect("json");
    let messages = body["messages"].as_array().expect("messages");
    let last = messages.last().expect("last");
    assert_eq!(last["role"], "user");
    assert_eq!(last["content"][0]["type"], "tool_result");
    assert_eq!(last["content"][0]["tool_use_id"], "tu1");
    assert_eq!(last["content"][0]["content"], "{\"a\":1}");
}
