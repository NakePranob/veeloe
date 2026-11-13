//! What the supervisor and a worker say to each other over IPC (ADR 0020).
//!
//! It sits in the core because both sides need it and neither may import the
//! other. Ported from `packages/runtime-legacy/src/ipc.ts`; only the messages
//! the agent loop needs are here so far — the LLM proxy joins in task 2.5.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::event_store::{TaskEvent, TaskSummary};

/// The answer the owner gives to one Approval (ADR 0030).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Approve,
    Deny,
    Redirect,
}

/// Headers travel as a JSON object, the way the legacy IPC sends them.
pub mod header_pairs {
    use serde::de::Deserializer;
    use serde::Deserialize;
    use serde::ser::{SerializeMap, Serializer};
    use std::collections::BTreeMap;

    pub fn serialize<S: Serializer>(
        headers: &[(String, String)],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(headers.len()))?;
        for (name, value) in headers {
            map.serialize_entry(name, value)?;
        }
        map.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<(String, String)>, D::Error> {
        Ok(BTreeMap::<String, String>::deserialize(deserializer)?
            .into_iter()
            .collect())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ToWorker {
    /// A Member's message, already verified by the supervisor. `ref` is its
    /// envelope's signature, for errors.
    #[serde(rename = "message")]
    Message {
        task: String,
        id: String,
        member: String,
        text: String,
        #[serde(rename = "ref")]
        reference: String,
    },
    /// The Task's events after `after`, for the Member asking.
    #[serde(rename = "sync")]
    Sync {
        task: String,
        after: i64,
        member: String,
        #[serde(rename = "ref")]
        reference: String,
    },
    /// Which of this Agent's Tasks the Member may open: the ones they started (ADR 0060).
    #[serde(rename = "list")]
    List { member: String },
    /// A Member stops the Turn running in this Task (`stop-and-restart`).
    #[serde(rename = "stop")]
    Stop {
        task: String,
        id: String,
        member: String,
        #[serde(rename = "ref")]
        reference: String,
    },
    /// The Agent was renamed, or its Allowlist or Approval timeout changed: the
    /// next tool call uses all three (ADR 0023).
    #[serde(rename = "agent")]
    Agent {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        allowlist: Option<Vec<String>>,
        #[serde(
            rename = "approvalTimeoutS",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        approval_timeout_s: Option<u64>,
    },
    /// The supervisor's answer to one `llm.request`. A Stop drops the wait, so
    /// a late answer is thrown away (ADR 0017).
    #[serde(rename = "llm.response")]
    LlmResponse {
        id: String,
        status: u16,
        #[serde(with = "header_pairs")]
        headers: Vec<(String, String)>,
        body: String,
    },
    /// The supervisor's answer to one waiting Approval. `task` binds it to the
    /// Task that asked.
    #[serde(rename = "approval")]
    Approval {
        request: String,
        decision: ApprovalDecision,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        member: String,
        #[serde(rename = "ref")]
        reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task: Option<String>,
    },
    /// The Task log's answer to one [`FromWorker::LogRead`].
    #[serde(rename = "log.answer")]
    LogAnswer { id: String, answer: LogAnswer },
    /// The event the supervisor wrote, for the append that asked for it.
    #[serde(rename = "log.appended")]
    LogAppended { id: String, event: TaskEvent },
    /// The supervisor refused or failed one read or append, so the worker sees
    /// a refusal instead of an event that never reached the log.
    #[serde(rename = "log.failed")]
    LogFailed { id: String, code: String },
}

/// One read of the Task log, asked by a worker that cannot open the file: the
/// supervisor owns the log (ADR 0020, 0069).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "query", rename_all = "camelCase")]
pub enum LogQuery {
    Starter { task: String },
    HasMessage { id: String },
    Events { task: String, after: i64 },
    TasksStartedBy { member: String },
    OpenTurns,
}

/// The log's answer to one [`LogQuery`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "answer", rename_all = "camelCase")]
pub enum LogAnswer {
    Starter { starter: Option<String> },
    HasMessage { seen: bool },
    Events { events: Vec<TaskEvent> },
    TasksStartedBy { tasks: Vec<TaskSummary> },
    OpenTurns { tasks: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum FromWorker {
    /// The worker has closed every Turn a restart left open and takes work now.
    #[serde(rename = "ready")]
    Ready,
    /// A new event, for the Member who started the Task.
    #[serde(rename = "event")]
    Event {
        task: String,
        starter: String,
        event: TaskEvent,
    },
    #[serde(rename = "events")]
    Events {
        task: String,
        member: String,
        events: Vec<TaskEvent>,
    },
    #[serde(rename = "tasks")]
    Tasks {
        member: String,
        tasks: Vec<TaskSummary>,
    },
    #[serde(rename = "error")]
    Error {
        member: String,
        #[serde(rename = "ref")]
        reference: String,
        code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task: Option<String>,
    },
    /// One HTTP request to the Provider, carried over IPC because the sandbox
    /// gives a worker no port to reach (ADR 0008, 0042).
    #[serde(rename = "llm.request")]
    LlmRequest {
        id: String,
        method: String,
        path: String,
        #[serde(with = "header_pairs")]
        headers: Vec<(String, String)>,
        body: String,
    },
    /// One event to write. The supervisor is the only writer, and it answers
    /// with [`ToWorker::LogAppended`] once the event is committed (ADR 0069).
    #[serde(rename = "log.append")]
    LogAppend {
        id: String,
        task: String,
        starter: String,
        #[serde(rename = "eventKind")]
        kind: String,
        body: Value,
        #[serde(
            rename = "messageId",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        message_id: Option<String>,
    },
    /// One read of the log, which the worker cannot open itself.
    #[serde(rename = "log.read")]
    LogRead { id: String, query: LogQuery },
}

/// One HTTP request to a Provider, carried over IPC (ADR 0008, 0042).
#[derive(Debug, Clone, PartialEq)]
pub struct LlmHttpRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// The Provider's whole answer, or the supervisor's refusal named in
/// `x-veeloe-error`.
#[derive(Debug, Clone, PartialEq)]
pub struct LlmHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// A header value by name, whatever case it was sent in.
pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

/// The core's only way out to the supervisor. Adapters implement it; tests fake it.
pub trait SupervisorLink: Send + Sync {
    fn send(&self, message: FromWorker);
}
