//! The core of one Agent: the Task log, the conversation, the tool loop, and
//! the Stop and Approval rules around them.

pub mod agent;
pub mod conversation;
pub mod event_store;
pub mod ipc;
pub mod memory;
pub mod sandbox;
pub mod ports;
pub mod usage;

pub use agent::{AgentCore, AgentError, APPROVAL_TIMEOUT_MS, MAX_ROUNDS};
pub use conversation::conversation;
pub use event_store::{
    Clock, EventLog, EventStore, StoreError, SystemClock, TaskEvent, TaskSummary,
};
pub use ipc::{
    header, ApprovalDecision, FromWorker, LlmHttpRequest, LlmHttpResponse, LogAnswer, LogQuery,
    SupervisorLink, ToWorker,
};
pub use ports::{Llm, LlmError, LlmMessage, LlmReply, LlmRequest};
pub use usage::usage_in;
