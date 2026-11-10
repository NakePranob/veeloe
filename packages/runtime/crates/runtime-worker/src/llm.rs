//! The LLM, through the supervisor (ADR 0004, 0042), ported from
//! `packages/runtime-legacy/src/worker/adapters/anthropic-llm.ts`.
//!
//! The worker holds no key and reaches no port: every request goes over its IPC
//! to the supervisor, which puts the Provider's key in and the Agent's model.
//! The answer is read whole here, a stream included, because the core keeps only
//! the finished message.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Map, Value};
use veeloe_plugin_api::Cancel;
use veeloe_runtime_core::ipc::{header, LlmHttpRequest, LlmHttpResponse};
use veeloe_runtime_core::{Llm, LlmError, LlmReply, LlmRequest};

/// The header the supervisor names its own refusals in.
pub const PROXY_ERROR_HEADER: &str = "x-veeloe-error";
/// The header the supervisor reads the Task of a request from, and drops.
pub const TASK_HEADER: &str = "x-veeloe-task";

/// One ceiling for every model. Read it from the Provider's model list when a
/// model needs more or allows less.
pub const MAX_TOKENS: u64 = 8192;

/// How a worker reaches the supervisor. The real one writes `llm.request` over
/// the IPC and waits for `llm.response`; tests fake it.
#[async_trait]
pub trait LlmTransport: Send + Sync {
    async fn call(
        &self,
        request: LlmHttpRequest,
        cancel: &Cancel,
    ) -> Result<LlmHttpResponse, LlmError>;
}

pub struct AnthropicLlm {
    transport: Arc<dyn LlmTransport>,
}

impl AnthropicLlm {
    pub fn new(transport: Arc<dyn LlmTransport>) -> Self {
        Self { transport }
    }
}

#[async_trait]
impl Llm for AnthropicLlm {
    async fn send(&self, request: LlmRequest, cancel: &Cancel) -> Result<LlmReply, LlmError> {
        let mut body = Map::new();
        body.insert("model".into(), json!("agent"));
        body.insert("max_tokens".into(), json!(MAX_TOKENS));
        // Streamed, like the legacy adapter: a plain request may run long, and
        // the worker keeps only the finished message either way.
        body.insert("stream".into(), json!(true));
        body.insert("system".into(), json!(request.system));
        body.insert(
            "messages".into(),
            Value::Array(
                request
                    .messages
                    .iter()
                    .map(|message| json!({ "role": message.role, "content": message.content }))
                    .collect(),
            ),
        );
        if !request.tools.is_empty() {
            body.insert(
                "tools".into(),
                Value::Array(
                    request
                        .tools
                        .iter()
                        .map(|tool| {
                            json!({
                                "name": tool.name,
                                "description": tool.description,
                                "input_schema": tool.input_schema,
                            })
                        })
                        .collect(),
                ),
            );
        }

        let answer = self
            .transport
            .call(
                LlmHttpRequest {
                    method: "POST".into(),
                    path: "/v1/messages".into(),
                    headers: vec![
                        ("content-type".into(), "application/json".into()),
                        ("anthropic-version".into(), "2023-06-01".into()),
                        (TASK_HEADER.into(), request.task.clone()),
                    ],
                    body: Value::Object(body).to_string(),
                },
                cancel,
            )
            .await
            .map_err(|error| {
                // A Stop is not a Provider problem: the core turns it into a
                // stopped Turn (ADR 0017).
                if cancel.is_cancelled() {
                    LlmError::Failed("turn.stopped".into())
                } else {
                    error
                }
            })?;

        if answer.status != 200 {
            let code = header(&answer.headers, PROXY_ERROR_HEADER)
                .unwrap_or("provider.failed");
            return Err(LlmError::Failed(code.to_string()));
        }
        final_message(&answer.body)
    }
}

/// The finished message of an answer, whether it is one JSON body or an SSE
/// stream: the content blocks and the stop reason, and nothing the transport
/// hangs on them.
pub fn final_message(body: &str) -> Result<LlmReply, LlmError> {
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') {
        let message: Value = serde_json::from_str(trimmed)
            .map_err(|_| LlmError::Failed("provider.failed".into()))?;
        return Ok(LlmReply {
            content: message
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            stop_reason: message
                .get("stop_reason")
                .and_then(Value::as_str)
                .map(str::to_string),
        });
    }
    stream_message(body)
}

/// Assembles the message a stream describes: `content_block_start` opens a
/// block, `content_block_delta` adds to it, `message_delta` names the stop
/// reason. A tool's input arrives as partial JSON, so it is parsed once at the
/// end.
fn stream_message(body: &str) -> Result<LlmReply, LlmError> {
    let mut blocks: Vec<Value> = Vec::new();
    let mut partial: Vec<String> = Vec::new();
    let mut stop_reason: Option<String> = None;

    for line in body.split('\n') {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let block = event.get("content_block").cloned().unwrap_or(Value::Null);
                while blocks.len() <= index {
                    blocks.push(Value::Null);
                    partial.push(String::new());
                }
                blocks[index] = block;
            }
            Some("content_block_delta") => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let Some(delta) = event.get("delta") else {
                    continue;
                };
                while blocks.len() <= index {
                    blocks.push(Value::Null);
                    partial.push(String::new());
                }
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let text = delta.get("text").and_then(Value::as_str).unwrap_or_default();
                        let current = blocks[index]
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        blocks[index]["text"] = json!(format!("{current}{text}"));
                    }
                    Some("input_json_delta") => {
                        partial[index].push_str(
                            delta
                                .get("partial_json")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        );
                    }
                    _ => {}
                }
            }
            Some("message_delta") => {
                if let Some(reason) = event
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    stop_reason = Some(reason.to_string());
                }
            }
            _ => {}
        }
    }

    for (index, block) in blocks.iter_mut().enumerate() {
        if block.get("type").and_then(Value::as_str) == Some("tool_use") && !partial[index].is_empty()
        {
            if let Ok(input) = serde_json::from_str::<Value>(&partial[index]) {
                block["input"] = input;
            }
        }
    }
    Ok(LlmReply {
        content: blocks.into_iter().filter(|block| !block.is_null()).collect(),
        stop_reason,
    })
}
