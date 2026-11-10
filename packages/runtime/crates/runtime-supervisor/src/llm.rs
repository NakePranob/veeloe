//! Every request to an LLM goes through here (ADR 0042), ported from
//! `packages/runtime-legacy/src/supervisor/proxy/proxy.ts`.
//!
//! It comes over the IPC of one worker, so the Agent is the one whose worker
//! that is, never what the request says. This puts the Provider's key in and the
//! model the Task is pinned to, and answers once the Provider has sent
//! everything, a stream included: the worker only keeps the finished message.
//! Nothing listens on a port.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use veeloe_runtime_core::ipc::{header, FromWorker, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_core::usage_in;

/// The header the supervisor names its own refusals in.
pub const PROXY_ERROR_HEADER: &str = "x-veeloe-error";
/// The header a worker names the Task of a request in; the supervisor reads it
/// and never sends it on.
pub const TASK_HEADER: &str = "x-veeloe-task";

/// The one place a request may go.
const ALLOWED: [&str; 2] = ["/v1/messages", "/v1/messages/count_tokens"];

/// What a worker sent that must not reach the Provider: the SDK's placeholder
/// key, what the client sets itself, and the Runtime's own `x-veeloe-*` headers.
const DROPPED: [&str; 6] = [
    "host",
    "x-api-key",
    "authorization",
    "content-length",
    "connection",
    "accept-encoding",
];

/// What an Agent's requests go to: the Provider, its model and the headers that
/// Provider needs. `None` when there is no such Agent.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub url: String,
    pub model: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Ready(Target),
    /// The Agent has no Provider or no model yet.
    Missing,
}

/// The Provider's answer, read whole.
#[derive(Debug, Clone, PartialEq)]
pub struct HttpAnswer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// How the supervisor reaches a Provider. The real one speaks HTTPS; tests fake it.
#[async_trait]
pub trait HttpClient: Send + Sync {
    /// A read that changes nothing: what a Provider offers, and nothing else.
    async fn get(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
    ) -> Result<HttpAnswer, String>;
    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<HttpAnswer, String>;
}

pub struct LlmProxy {
    client: Arc<dyn HttpClient>,
    route: Box<dyn Fn(&str, Option<&str>) -> Option<Route> + Send + Sync>,
    /// False when this Agent's Budget is spent: its next answer is refused
    /// before the Provider is asked (ADR 0043).
    allow: Box<dyn Fn(&str) -> bool + Send + Sync>,
    /// Every answer that reported `usage`, after it was read whole.
    usage: Box<dyn Fn(&str, Option<&str>, u64) + Send + Sync>,
    /// A line for the operator when an answer says nothing of `usage`, so a
    /// Budget silently stops protecting (ADR 0043).
    log: Box<dyn Fn(&str) + Send + Sync>,
}

impl LlmProxy {
    pub fn new(client: Arc<dyn HttpClient>) -> Self {
        Self {
            client,
            route: Box::new(|_, _| None),
            allow: Box::new(|_| true),
            usage: Box::new(|_, _, _| {}),
            log: Box::new(|_| {}),
        }
    }

    pub fn route(
        mut self,
        route: impl Fn(&str, Option<&str>) -> Option<Route> + Send + Sync + 'static,
    ) -> Self {
        self.route = Box::new(route);
        self
    }

    pub fn allow(mut self, allow: impl Fn(&str) -> bool + Send + Sync + 'static) -> Self {
        self.allow = Box::new(allow);
        self
    }

    pub fn on_usage(
        mut self,
        usage: impl Fn(&str, Option<&str>, u64) + Send + Sync + 'static,
    ) -> Self {
        self.usage = Box::new(usage);
        self
    }

    pub fn log(mut self, log: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.log = Box::new(log);
        self
    }

    pub async fn handle(&self, agent: &str, request: &LlmHttpRequest) -> LlmHttpResponse {
        let task = header(&request.headers, TASK_HEADER).map(str::to_string);
        let Some(route) = (self.route)(agent, task.as_deref()) else {
            return refuse(401, "proxy.unknown_worker");
        };
        let (pathname, search) = split_path(&request.path);
        if request.method != "POST" || !ALLOWED.contains(&pathname.as_str()) {
            return refuse(404, "proxy.not_allowed");
        }
        let Route::Ready(target) = route else {
            return refuse(424, "provider.missing");
        };
        // `count_tokens` costs nothing, so it passes even with the Budget spent
        // and is never counted.
        let counted = pathname == "/v1/messages";
        if counted && !(self.allow)(agent) {
            return refuse_with(429, "budget.exhausted", &[("x-should-retry", "false")]);
        }

        let Ok(mut body) = serde_json::from_str::<Value>(&request.body) else {
            return refuse(400, "proxy.bad_request");
        };
        if !body.is_object() {
            return refuse(400, "proxy.bad_request");
        }

        let mut headers: Vec<(String, String)> = Vec::new();
        for (name, value) in &request.headers {
            let lower = name.to_ascii_lowercase();
            if !DROPPED.contains(&lower.as_str()) && !lower.starts_with("x-veeloe-") {
                set_header(&mut headers, name, value);
            }
        }
        for (name, value) in &target.headers {
            set_header(&mut headers, name, value);
        }
        body["model"] = json!(target.model);

        let url = format!("{}{}{}", target.url, pathname, search);
        let answer = match self
            .client
            .post(&url, headers, body.to_string())
            .await
        {
            Ok(answer) => answer,
            Err(_) => return refuse(502, "provider.unreachable"),
        };

        if counted {
            match usage_in(&answer.body) {
                Some(tokens) => (self.usage)(agent, task.as_deref(), tokens),
                None => (self.log)(&format!(
                    "agent {agent}: the answer reported no usage, so its tokens were not counted"
                )),
            }
        }
        // The client has already undone any compression, so the length and
        // encoding the Provider sent no longer hold.
        let headers: Vec<(String, String)> = answer
            .headers
            .into_iter()
            .filter(|(name, _)| {
                let lower = name.to_ascii_lowercase();
                lower != "content-encoding" && lower != "content-length"
            })
            .collect();
        LlmHttpResponse {
            status: answer.status,
            headers,
            body: answer.body,
        }
    }
}

/// Turns one `llm.request` into the answer the worker gets. The Agent is the
/// worker's, never the request's.
pub async fn answer(proxy: &LlmProxy, agent: &str, message: &FromWorker) -> LlmHttpResponse {
    let FromWorker::LlmRequest {
        method,
        path,
        headers,
        body,
        ..
    } = message
    else {
        return refuse(500, "proxy.bad_request");
    };
    proxy
        .handle(
            agent,
            &LlmHttpRequest {
                method: method.clone(),
                path: path.clone(),
                headers: headers.clone(),
                body: body.clone(),
            },
        )
        .await
}

fn split_path(path: &str) -> (String, String) {
    match path.split_once('?') {
        Some((pathname, search)) => (pathname.to_string(), format!("?{search}")),
        None => (path.to_string(), String::new()),
    }
}

fn set_header(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    match headers
        .iter_mut()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
    {
        Some(slot) => slot.1 = value.to_string(),
        None => headers.push((name.to_string(), value.to_string())),
    }
}

fn refuse(status: u16, code: &str) -> LlmHttpResponse {
    refuse_with(status, code, &[])
}

fn refuse_with(status: u16, code: &str, extra: &[(&str, &str)]) -> LlmHttpResponse {
    let mut headers = vec![
        ("content-type".to_string(), "application/json".to_string()),
        (PROXY_ERROR_HEADER.to_string(), code.to_string()),
    ];
    for (name, value) in extra {
        headers.push((name.to_string(), value.to_string()));
    }
    LlmHttpResponse {
        status,
        headers,
        body: json!({
            "type": "error",
            "error": { "type": "veeloe_error", "message": code },
        })
        .to_string(),
    }
}
