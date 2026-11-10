//! The LLM proxy, ported from `packages/runtime-legacy/src/supervisor/proxy/proxy.test.ts`.
//!
//! The Provider is faked: what is under test is what the proxy refuses, what it
//! adds, and what it never sends on.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{json, Value};
use veeloe_runtime_core::{FromWorker, LlmHttpRequest};
use veeloe_runtime_supervisor::llm::{
    answer, HttpClient, HttpAnswer, LlmProxy, Route, Target, PROXY_ERROR_HEADER,
};

#[derive(Default)]
struct FakeClient {
    calls: Mutex<Vec<(String, Vec<(String, String)>, String)>>,
    answer: Mutex<Option<Result<HttpAnswer, String>>>,
}

impl FakeClient {
    fn answering(answer: HttpAnswer) -> Arc<Self> {
        let client = Self::default();
        *client.answer.lock().expect("answer") = Some(Ok(answer));
        Arc::new(client)
    }

    fn unreachable() -> Arc<Self> {
        let client = Self::default();
        *client.answer.lock().expect("answer") = Some(Err("offline".into()));
        Arc::new(client)
    }

    fn calls(&self) -> Vec<(String, Vec<(String, String)>, String)> {
        self.calls.lock().expect("calls").clone()
    }
}

#[async_trait]
impl HttpClient for FakeClient {
    async fn get(
        &self,
        _url: &str,
        _headers: Vec<(String, String)>,
    ) -> Result<HttpAnswer, String> {
        Err("the proxy only posts".into())
    }

    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<HttpAnswer, String> {
        self.calls
            .lock()
            .expect("calls")
            .push((url.to_string(), headers, body));
        self.answer
            .lock()
            .expect("answer")
            .clone()
            .unwrap_or_else(|| Err("no answer".into()))
    }
}

fn target() -> Target {
    Target {
        url: "https://api.anthropic.test".into(),
        model: "claude-test".into(),
        headers: vec![("x-api-key".into(), "sk-the-key".into())],
    }
}

fn request() -> LlmHttpRequest {
    LlmHttpRequest {
        method: "POST".into(),
        path: "/v1/messages".into(),
        headers: vec![
            ("content-type".into(), "application/json".into()),
            ("x-api-key".into(), "held-by-the-supervisor".into()),
            ("x-veeloe-task".into(), "t1".into()),
            ("user-agent".into(), "veeloe/0.0.0".into()),
        ],
        body: json!({ "model": "agent", "max_tokens": 10, "messages": [] }).to_string(),
    }
}

fn proxy(client: Arc<FakeClient>) -> LlmProxy {
    LlmProxy::new(client).route(|agent, _task| {
        if agent == "a1" {
            Some(Route::Ready(target()))
        } else {
            None
        }
    })
}

fn block() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
}

#[test]
fn a_request_for_an_unknown_worker_is_refused_before_anything_else() {
    let client = Arc::new(FakeClient::default());
    let response = block().block_on(proxy(Arc::clone(&client)).handle("nobody", &request()));
    assert_eq!(response.status, 401);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("proxy.unknown_worker")
    );
    assert!(client.calls().is_empty());
}

#[test]
fn only_the_messages_paths_are_allowed_and_only_by_post() {
    let client = Arc::new(FakeClient::default());
    let proxy = proxy(Arc::clone(&client));
    let mut get = request();
    get.method = "GET".into();
    assert_eq!(
        block().block_on(proxy.handle("a1", &get)).status,
        404
    );
    let mut elsewhere = request();
    elsewhere.path = "/v1/complete".into();
    let response = block().block_on(proxy.handle("a1", &elsewhere));
    assert_eq!(response.status, 404);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("proxy.not_allowed")
    );
    assert!(client.calls().is_empty());
}

#[test]
fn an_agent_with_no_provider_is_refused_as_provider_missing() {
    let client = Arc::new(FakeClient::default());
    let proxy = LlmProxy::new(Arc::clone(&client) as Arc<dyn HttpClient>)
        .route(|_agent, _task| Some(Route::Missing));
    let response = block().block_on(proxy.handle("a1", &request()));
    assert_eq!(response.status, 424);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("provider.missing")
    );
}

#[test]
fn a_spent_budget_refuses_the_answer_before_the_provider_is_asked_but_count_tokens_passes() {
    let client = Arc::new(FakeClient::default());
    let proxy = proxy(Arc::clone(&client)).allow(|_agent| false);
    let response = block().block_on(proxy.handle("a1", &request()));
    assert_eq!(response.status, 429);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("budget.exhausted")
    );
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, "x-should-retry"),
        Some("false")
    );
    assert!(client.calls().is_empty());

    let mut counted = request();
    counted.path = "/v1/messages/count_tokens".into();
    let response = block().block_on(proxy.handle("a1", &counted));
    // No answer was faked, so the Provider is "unreachable": what matters is
    // that the Budget did not refuse it.
    assert_eq!(response.status, 502);
}

#[test]
fn a_body_that_is_not_json_is_refused_as_bad_request() {
    let client = Arc::new(FakeClient::default());
    let mut broken = request();
    broken.body = "not json".into();
    let response = block().block_on(proxy(Arc::clone(&client)).handle("a1", &broken));
    assert_eq!(response.status, 400);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("proxy.bad_request")
    );
}

#[test]
fn the_providers_key_and_model_go_in_and_the_workers_key_and_task_header_do_not() {
    let client = FakeClient::answering(HttpAnswer {
        status: 200,
        headers: vec![
            ("content-type".into(), "application/json".into()),
            ("content-encoding".into(), "gzip".into()),
            ("content-length".into(), "123".into()),
        ],
        body: json!({ "content": [], "stop_reason": "end_turn" }).to_string(),
    });
    let response = block().block_on(proxy(Arc::clone(&client)).handle("a1", &request()));
    assert_eq!(response.status, 200);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, "content-encoding"),
        None
    );
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, "content-length"),
        None
    );

    let calls = client.calls();
    assert_eq!(calls.len(), 1);
    let (url, headers, body) = &calls[0];
    assert_eq!(url, "https://api.anthropic.test/v1/messages");
    assert_eq!(
        veeloe_runtime_core::header(headers, "x-api-key"),
        Some("sk-the-key")
    );
    assert_eq!(veeloe_runtime_core::header(headers, "x-veeloe-task"), None);
    assert_eq!(
        veeloe_runtime_core::header(headers, "user-agent"),
        Some("veeloe/0.0.0")
    );
    let sent: Value = serde_json::from_str(body).expect("json");
    assert_eq!(sent["model"], "claude-test");
    assert_eq!(sent["max_tokens"], 10);
}

#[test]
fn an_answer_that_reported_usage_is_counted_with_its_task() {
    let client = FakeClient::answering(HttpAnswer {
        status: 200,
        headers: Vec::new(),
        body: json!({ "content": [], "usage": { "input_tokens": 10, "output_tokens": 5 } }).to_string(),
    });
    let counted: Arc<Mutex<Vec<(String, Option<String>, u64)>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&counted);
    let proxy = proxy(Arc::clone(&client)).on_usage(move |agent, task, tokens| {
        sink.lock()
            .expect("counted")
            .push((agent.to_string(), task.map(str::to_string), tokens));
    });
    block().block_on(proxy.handle("a1", &request()));
    assert_eq!(
        *counted.lock().expect("counted"),
        vec![("a1".to_string(), Some("t1".to_string()), 15)]
    );
}

#[test]
fn an_answer_that_says_nothing_of_usage_is_reported_rather_than_counted() {
    let client = FakeClient::answering(HttpAnswer {
        status: 200,
        headers: Vec::new(),
        body: json!({ "content": [] }).to_string(),
    });
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let proxy = proxy(Arc::clone(&client)).log(move |line| {
        sink.lock().expect("lines").push(line.to_string());
    });
    block().block_on(proxy.handle("a1", &request()));
    let lines = lines.lock().expect("lines");
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("reported no usage"));
}

#[test]
fn a_provider_that_cannot_be_reached_is_provider_unreachable() {
    let client = FakeClient::unreachable();
    let response = block().block_on(proxy(Arc::clone(&client)).handle("a1", &request()));
    assert_eq!(response.status, 502);
    assert_eq!(
        veeloe_runtime_core::header(&response.headers, PROXY_ERROR_HEADER),
        Some("provider.unreachable")
    );
}

#[test]
fn an_llm_request_message_is_answered_the_same_way() {
    let client = FakeClient::answering(HttpAnswer {
        status: 200,
        headers: Vec::new(),
        body: "{}".into(),
    });
    let message = FromWorker::LlmRequest {
        id: "1".into(),
        method: "POST".into(),
        path: "/v1/messages".into(),
        headers: vec![("x-veeloe-task".into(), "t1".into())],
        body: json!({ "messages": [] }).to_string(),
    };
    let response = block().block_on(answer(&proxy(Arc::clone(&client)), "a1", &message));
    assert_eq!(response.status, 200);
}
