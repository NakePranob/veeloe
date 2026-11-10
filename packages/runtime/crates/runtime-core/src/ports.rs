//! The core's only ways out (ADR 0022): adapters implement these, tests fake them.
//! Ported from `packages/runtime-legacy/src/worker/core/ports.ts`.

use async_trait::async_trait;
use veeloe_plugin_api::{Cancel, ToolDefinition};

#[derive(Debug, Clone, PartialEq)]
pub struct LlmRequest {
    pub task: String,
    pub system: String,
    pub messages: Vec<LlmMessage>,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LlmMessage {
    pub role: String,
    pub content: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LlmReply {
    pub content: Vec<serde_json::Value>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LlmError {
    #[error("{0}")]
    Failed(String),
}

impl LlmError {
    /// The code the log carries when a Provider fails (`provider.unreachable`).
    pub fn code(&self) -> &str {
        match self {
            Self::Failed(code) => code,
        }
    }
}

/// One request to the Provider. A pulled `cancel` ends the wait, so a Stop does
/// not leave a request running behind a Turn that already ended (ADR 0017).
#[async_trait]
pub trait Llm: Send + Sync {
    async fn send(&self, request: LlmRequest, cancel: &Cancel) -> Result<LlmReply, LlmError>;
}
