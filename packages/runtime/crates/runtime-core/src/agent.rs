//! One Agent: one Turn at a time (ADR 0011), each in the name of the Member who
//! sent its message (ADR 0010). Everything it does is an event in the log first,
//! and every event goes to the Member who started the Task.
//!
//! Ported from `packages/runtime-legacy/src/worker/core/agent.ts`. The Stop and
//! Approval semantics are the same: a Stop ends the Turn as `stopped` and cuts
//! what it holds (ADR 0017), an Approval waits an hour and then counts as
//! denied (ADR 0030), and the file tools never wait because the sandbox holds
//! them already.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use veeloe_plugin_api::{Cancel, PluginError, ToolError, ToolRegistry};
use veeloe_protocol::{matches_allowlist, split_command};

use crate::conversation::conversation;
use crate::event_store::{EventStore, StoreError, TaskEvent};
use crate::ipc::{ApprovalDecision, FromWorker, SupervisorLink, ToWorker};
use crate::ports::{Llm, LlmError, LlmMessage, LlmRequest};

/// How many times one Turn may go back to the LLM, so a tool loop cannot run all night.
pub const MAX_ROUNDS: usize = 50;

/// The tools that read and write the Workdir: the sandbox holds them, never the
/// Allowlist (`file-tools`, ADR 0030).
const FILE_TOOL_NAMES: [&str; 6] = ["read", "write", "edit", "glob", "grep", "send_file"];

/// How long one Approval waits for an answer before it counts as denied
/// (ADR 0030 proposes an hour).
pub const APPROVAL_TIMEOUT_MS: u64 = 3_600_000;

/// Stop ids already obeyed: the same command sent again stops nothing twice.
/// The oldest fall away.
const STOPPED_IDS_KEPT: usize = 100;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("llm: {0}")]
    Llm(#[from] LlmError),
    #[error("tool: {0}")]
    Tool(#[from] ToolError),
    #[error("plugin: {0}")]
    Plugin(#[from] PluginError),
}

#[derive(Debug)]
struct RunningTurn {
    task: String,
    starter: String,
    cancel: Cancel,
}

#[derive(Debug)]
struct Waiter {
    task: String,
    starter: String,
    answer: oneshot::Sender<Answer>,
}

#[derive(Debug, Clone, PartialEq)]
struct Answer {
    request: String,
    decision: ApprovalDecision,
    message: Option<String>,
}

struct State {
    name: RwLock<String>,
    workdir: Mutex<Option<PathBuf>>,
    store: Mutex<EventStore>,
    llm: Arc<dyn Llm>,
    tools: Arc<ToolRegistry>,
    link: Arc<dyn SupervisorLink>,
    allowlist: RwLock<Vec<String>>,
    approval_timeout_ms: AtomicU64,
    running: Mutex<Option<RunningTurn>>,
    /// Messages that arrived while a Turn was running, in arrival order.
    queued: Mutex<VecDeque<ToWorker>>,
    stopped_ids: Mutex<VecDeque<String>>,
    waiting: Mutex<HashMap<String, Waiter>>,
    approvals: AtomicU64,
    max_rounds: AtomicUsize,
    context_window: AtomicUsize,
    turn: Mutex<Option<JoinHandle<()>>>,
}

impl State {
    fn append(
        &self,
        task: &str,
        starter: &str,
        kind: &str,
        body: Value,
        message_id: Option<&str>,
    ) -> Result<TaskEvent, AgentError> {
        let event = {
            let mut store = self.store.lock().expect("store");
            store.append(task, kind, &body, message_id)?
        };
        self.link.send(FromWorker::Event {
            task: task.to_string(),
            starter: starter.to_string(),
            event: event.clone(),
        });
        Ok(event)
    }

    fn allowlist(&self) -> Vec<String> {
        self.allowlist.read().expect("allowlist").clone()
    }

    fn approval_timeout(&self) -> Duration {
        Duration::from_millis(self.approval_timeout_ms.load(Ordering::SeqCst))
    }
}

pub struct AgentCore {
    state: Arc<State>,
}

impl AgentCore {
    pub fn new(
        name: impl Into<String>,
        store: EventStore,
        llm: Arc<dyn Llm>,
        tools: ToolRegistry,
        link: Arc<dyn SupervisorLink>,
    ) -> Self {
        Self {
            state: Arc::new(State {
                name: RwLock::new(name.into()),
                workdir: Mutex::new(None),
                store: Mutex::new(store),
                llm,
                tools: Arc::new(tools),
                link,
                allowlist: RwLock::new(Vec::new()),
                approval_timeout_ms: AtomicU64::new(APPROVAL_TIMEOUT_MS),
                running: Mutex::new(None),
                queued: Mutex::new(VecDeque::new()),
                stopped_ids: Mutex::new(VecDeque::new()),
                waiting: Mutex::new(HashMap::new()),
                approvals: AtomicU64::new(0),
                max_rounds: AtomicUsize::new(MAX_ROUNDS),
                context_window: AtomicUsize::new(128_000),
                turn: Mutex::new(None),
            }),
        }
    }

    pub fn with_max_rounds(self, max_rounds: usize) -> Self {
        self.state.max_rounds.store(max_rounds, Ordering::SeqCst);
        self
    }

    /// Pin this Workdir's `MEMORY.md` into each new Turn (ADR 0036).
    pub fn with_workdir(self, workdir: impl Into<PathBuf>) -> Self {
        *self.state.workdir.lock().expect("workdir") = Some(workdir.into());
        self
    }

    /// The model's context window; the 70% compaction threshold derives from it.
    pub fn with_context_window(self, tokens: usize) -> Self {
        if tokens > 0 {
            self.state.context_window.store(tokens, Ordering::SeqCst);
        }
        self
    }

    pub fn rename(&self, name: impl Into<String>) {
        *self.state.name.write().expect("name") = name.into();
    }

    /// The Allowlist from the supervisor: the next tool call uses it, a running
    /// wait keeps its own.
    pub fn set_allowlist(&self, allowlist: Vec<String>) {
        *self.state.allowlist.write().expect("allowlist") = allowlist;
    }

    /// The Approval timeout from the supervisor: the next wait uses it, a
    /// running wait keeps its own. Zero keeps the old value.
    pub fn set_approval_timeout_ms(&self, ms: u64) {
        if ms > 0 {
            self.state.approval_timeout_ms.store(ms, Ordering::SeqCst);
        }
    }

    pub fn events(&self, task: &str) -> Result<Vec<TaskEvent>, AgentError> {
        Ok(self.state.store.lock().expect("store").events(task, 0)?)
    }

    /// Everything the supervisor says to this worker, synchronous up to the
    /// start of a Turn, so two messages can never both find the Agent free.
    pub fn receive(&self, message: ToWorker) -> Result<(), AgentError> {
        match message {
            ToWorker::List { member } => self.list(&member),
            ToWorker::Stop {
                task,
                id,
                member,
                reference,
            } => self.stop(&task, &id, &member, &reference),
            ToWorker::Approval {
                request,
                decision,
                message,
                member,
                reference,
                task,
            } => self.answer_approval(&request, decision, message, &member, &reference, task.as_deref()),
            ToWorker::Agent {
                name,
                allowlist,
                approval_timeout_s,
            } => {
                self.rename(name);
                if let Some(allowlist) = allowlist {
                    self.set_allowlist(allowlist);
                }
                if let Some(seconds) = approval_timeout_s {
                    self.set_approval_timeout_ms(seconds.saturating_mul(1_000));
                }
                Ok(())
            }
            // An LLM answer belongs to the worker's IPC loop, not to the Agent.
            ToWorker::LlmResponse { .. } => Ok(()),
            ToWorker::Sync {
                task,
                after,
                member,
                reference,
            } => self.sync(&task, after, &member, &reference),
            ToWorker::Message {
                task,
                id,
                member,
                text,
                reference,
            } => self.message(&task, &id, &member, &text, &reference),
        }
    }

    fn list(&self, member: &str) -> Result<(), AgentError> {
        let tasks = self
            .state
            .store
            .lock()
            .expect("store")
            .tasks_started_by(member)?;
        self.state.link.send(FromWorker::Tasks {
            member: member.to_string(),
            tasks,
        });
        Ok(())
    }

    fn sync(
        &self,
        task: &str,
        after: i64,
        member: &str,
        reference: &str,
    ) -> Result<(), AgentError> {
        let starter = self.state.store.lock().expect("store").starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                return self.refuse(member, reference, "task.not_found", Some(task));
            }
        }
        if starter.is_none() {
            return self.refuse(member, reference, "task.not_found", Some(task));
        }
        let events = self
            .state
            .store
            .lock()
            .expect("store")
            .events(task, after)?;
        self.state.link.send(FromWorker::Events {
            task: task.to_string(),
            member: member.to_string(),
            events,
        });
        Ok(())
    }

    fn message(
        &self,
        task: &str,
        id: &str,
        member: &str,
        text: &str,
        reference: &str,
    ) -> Result<(), AgentError> {
        let starter = self.state.store.lock().expect("store").starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                return self.refuse(member, reference, "task.not_found", Some(task));
            }
        }
        if self.state.store.lock().expect("store").has_message(id)? {
            return Ok(()); // a resend: it is in the log already
        }
        if self.state.running.lock().expect("running").is_some() {
            self.state
                .queued
                .lock()
                .expect("queued")
                .push_back(ToWorker::Message {
                    task: task.to_string(),
                    id: id.to_string(),
                    member: member.to_string(),
                    text: text.to_string(),
                    reference: reference.to_string(),
                });
            return Ok(());
        }
        let fresh = starter.is_none();
        let owner = starter.unwrap_or_else(|| member.to_string());
        if fresh {
            self.state.store.lock().expect("store").create_task(task, &owner)?;
        }
        self.state.append(
            task,
            &owner,
            "member.message",
            json!({ "member": member, "id": id, "text": text }),
            Some(id),
        )?;

        // Once per Turn: a rename reaches the next Turn, never one halfway
        // through. Both are written here, before the Turn task is spawned, so a
        // Stop that arrives at once still lands after the start.
        let mut system = format!(
            "You are {}, an Agent that runs on its owner's own machine through Veeloe. Answer in the language the person writes in.",
            self.state.name.read().expect("name")
        );
        if let Some(workdir) = self.state.workdir.lock().expect("workdir").as_ref() {
            let memory = crate::memory::memory_prompt(workdir);
            if !memory.is_empty() {
                system.push_str("\n\nMEMORY.md, notes you keep for every Task:\n");
                system.push_str(&memory);
            }
        }
        self.state.append(
            task,
            &owner,
            "turn.started",
            json!({ "member": member }),
            None,
        )?;

        let cancel = Cancel::new();
        *self.state.running.lock().expect("running") = Some(RunningTurn {
            task: task.to_string(),
            starter: owner.clone(),
            cancel: cancel.clone(),
        });

        let state = Arc::clone(&self.state);
        let started = task.to_string();
        let handle = tokio::spawn(async move {
            let failed = run_turn(
                Arc::clone(&state),
                started.clone(),
                owner.clone(),
                system,
                cancel,
            )
            .await
            .is_err();
            *state.running.lock().expect("running") = None;
            if failed {
                // The log says the Turn ended even when the core itself failed,
                // so a Task never stays open because of an internal error.
                let _ = state.append(
                    &started,
                    &owner,
                    "turn.ended",
                    json!({ "reason": "error", "code": "runtime.failed" }),
                    None,
                );
            }
            drain_queued(state);
        });
        *self.state.turn.lock().expect("turn") = Some(handle);
        Ok(())
    }

    fn stop(
        &self,
        task: &str,
        id: &str,
        member: &str,
        reference: &str,
    ) -> Result<(), AgentError> {
        if self
            .state
            .stopped_ids
            .lock()
            .expect("stopped ids")
            .contains(&id.to_string())
        {
            return Ok(());
        }
        let starter = self.state.store.lock().expect("store").starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                return self.refuse(member, reference, "task.not_found", Some(task));
            }
        }
        let turn = self.state.running.lock().expect("running");
        let Some(turn) = turn.as_ref().filter(|turn| turn.task == task) else {
            return self.refuse(member, reference, "turn.not_running", Some(task));
        };

        let mut stopped = self.state.stopped_ids.lock().expect("stopped ids");
        stopped.push_back(id.to_string());
        while stopped.len() > STOPPED_IDS_KEPT {
            stopped.pop_front();
        }
        drop(stopped);

        // A Turn that is already stopping takes one Stop: the second is a no-op.
        if turn.cancel.is_cancelled() {
            return Ok(());
        }
        // Who stopped it, then the end the Stop itself causes, in that order.
        self.state.append(
            task,
            &turn.starter,
            "turn.stopped",
            json!({ "member": member }),
            None,
        )?;
        turn.cancel.cancel();
        Ok(())
    }

    fn answer_approval(
        &self,
        request: &str,
        decision: ApprovalDecision,
        message: Option<String>,
        member: &str,
        reference: &str,
        task: Option<&str>,
    ) -> Result<(), AgentError> {
        let waiter = self.state.waiting.lock().expect("waiting").remove(request);
        // Answered too late, never asked, or asked by another Task: the Turn
        // already moved on.
        let Some(waiter) = waiter else {
            return self.refuse(member, reference, "approval.unknown", None);
        };
        if task.is_some_and(|task| task != waiter.task) {
            return self.refuse(member, reference, "approval.unknown", None);
        }
        let mut body = json!({
            "request": request,
            "member": member,
            "decision": decision,
        });
        if let Some(message) = &message {
            body["message"] = json!(message);
        }
        self.state
            .append(&waiter.task, &waiter.starter, "approval.answered", body, None)?;
        // A closed receiver means the Turn already stopped; nothing to answer.
        let _ = waiter.answer.send(Answer {
            request: request.to_string(),
            decision,
            message,
        });
        Ok(())
    }

    fn refuse(
        &self,
        member: &str,
        reference: &str,
        code: &str,
        task: Option<&str>,
    ) -> Result<(), AgentError> {
        self.state.link.send(FromWorker::Error {
            member: member.to_string(),
            reference: reference.to_string(),
            code: code.to_string(),
            task: task.map(str::to_string),
        });
        Ok(())
    }

    /// Resolves when the Turn running now, if any, has ended.
    pub async fn idle(&self) {
        let handle = self.state.turn.lock().expect("turn").take();
        if let Some(handle) = handle {
            let _ = handle.await;
        }
    }

    /// Every Turn still open when this worker last ended is closed as
    /// interrupted, and nothing is made to run again (ADR 0033). Called once, as
    /// the worker starts.
    pub fn close_open_turns(&self) -> Result<(), AgentError> {
        let open = self.state.store.lock().expect("store").open_turns()?;
        for task in open {
            let Some(starter) = self.state.store.lock().expect("store").starter_of(&task)? else {
                continue;
            };
            self.state.append(
                &task,
                &starter,
                "turn.interrupted",
                json!({ "reason": "restart" }),
                None,
            )?;
            self.state.append(
                &task,
                &starter,
                "turn.ended",
                json!({ "reason": "interrupted" }),
                None,
            )?;
        }
        Ok(())
    }
}

async fn run_turn(
    state: Arc<State>,
    task: String,
    starter: String,
    system: String,
    cancel: Cancel,
) -> Result<(), AgentError> {
    let rounds = state.max_rounds.load(Ordering::SeqCst);
    for _ in 0..rounds {
        let mut events = state.store.lock().expect("store").events(&task, 0)?;
        if let Some(summary) = compact_if_needed(&state, &task, &events).await {
            if state
                .append(
                    &task,
                    &starter,
                    "context.compacted",
                    json!({
                        "summary": summary.summary,
                        "throughSeq": summary.through_seq,
                        "tokensBefore": summary.tokens_before,
                        "tokensAfter": summary.tokens_after,
                    }),
                    None,
                )
                .is_ok()
            {
                events = state.store.lock().expect("store").events(&task, 0)?;
            }
        }
        let request = LlmRequest {
            task: task.clone(),
            system: system.clone(),
            messages: conversation(&events),
            tools: state.tools.definitions(),
        };
        let window = state.context_window.load(Ordering::SeqCst);
        let _ = state.append(
            &task,
            &starter,
            "context.usage",
            json!({
                "tokens": rough_tokens(&request.messages),
                "window": window,
                "threshold": window * 70 / 100,
            }),
            None,
        );
        // A Stop ends the Turn as stopped, not as a Provider failure (ADR 0017).
        let reply = tokio::select! {
            biased;
            _ = cancel.cancelled() => None,
            reply = state.llm.send(request, &cancel) => Some(reply),
        };
        let Some(reply) = reply else {
            return end(&state, &task, &starter, "stopped", None);
        };
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                if cancel.is_cancelled() {
                    return end(&state, &task, &starter, "stopped", None);
                }
                let code = if error.code().is_empty() {
                    "provider.failed"
                } else {
                    error.code()
                };
                return end(&state, &task, &starter, "error", Some(code));
            }
        };
        // An answer that arrived after the Stop is not the Turn's answer: it is
        // dropped, not written.
        if cancel.is_cancelled() {
            return end(&state, &task, &starter, "stopped", None);
        }
        state.append(&task, &starter, "llm.message", json!({ "content": reply.content }), None)?;

        let uses: Vec<&Value> = reply
            .content
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
            .collect();
        if reply.stop_reason.as_deref() != Some("tool_use") || uses.is_empty() {
            return end(&state, &task, &starter, "done", None);
        }

        let mut results = Vec::new();
        for use_block in uses {
            let name = use_block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let id = use_block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let input = use_block.get("input").cloned().unwrap_or(Value::Null);
            let result = if !state.tools.has(name) {
                Err(ToolError::Unknown(name.to_string()))
            } else {
                run_tool(&state, &task, &starter, name, &input, &cancel).await
            };
            match result {
                Ok(content) => {
                    if name == "send_file" {
                        if let Ok(offered) = serde_json::from_str::<Value>(&content) {
                            state.append(&task, &starter, "file.offered", offered, None)?;
                        }
                    }
                    results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": content,
                    }))
                }
                Err(error) => results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": error.to_string(),
                    "is_error": true,
                })),
            }
        }
        // What the Stop cut off has no result to report; the screen shows those
        // commands as unfinished.
        if cancel.is_cancelled() {
            return end(&state, &task, &starter, "stopped", None);
        }
        state.append(&task, &starter, "tool.result", json!({ "content": results }), None)?;
    }

    end(
        &state,
        &task,
        &starter,
        "error",
        Some("turn.too_many_rounds"),
    )
}

/// Start one queued message after a Turn ends; that Turn's own end drains the next.
fn drain_queued(state: Arc<State>) {
    let Some(next) = state.queued.lock().expect("queued").pop_front() else {
        return;
    };
    let core = AgentCore {
        state: Arc::clone(&state),
    };
    let _ = core.receive(next);
}

fn end(
    state: &State,
    task: &str,
    starter: &str,
    reason: &str,
    code: Option<&str>,
) -> Result<(), AgentError> {
    let mut body = json!({ "reason": reason });
    if let Some(code) = code {
        body["code"] = json!(code);
    }
    state.append(task, starter, "turn.ended", body, None)?;
    Ok(())
}

struct Compacted {
    summary: String,
    through_seq: i64,
    tokens_before: usize,
    tokens_after: usize,
}

/// Summarize older history when the rough token count reaches 70% of the
/// window. A failed or empty summary leaves the Turn exactly as it was.
async fn compact_if_needed(
    state: &Arc<State>,
    task: &str,
    events: &[TaskEvent],
) -> Option<Compacted> {
    // A tool round is not a safe split: its call would lose its result.
    if events.last().is_some_and(|event| event.kind == "llm.message") {
        return None;
    }
    let window = state.context_window.load(Ordering::SeqCst);
    if window == 0 {
        return None;
    }
    // Keep the message that started this Turn outside the summary, so the
    // model still sees the exact request beside the summary.
    let split = if events.last().is_some_and(|event| event.kind == "member.message") {
        events.len().saturating_sub(1)
    } else {
        events.len()
    };
    let messages = conversation(&events[..split]);
    let before = rough_tokens(&messages);
    if before < window * 70 / 100 {
        return None;
    }
    let transcript = transcript_text(&messages);
    if transcript.is_empty() {
        return None;
    }
    let request = LlmRequest {
        task: task.to_string(),
        system: "You compact an AI Agent's Task history. Keep the goal, decisions, files changed, approvals, and work still pending. Do not invent facts. Return only the summary.".into(),
        messages: vec![LlmMessage {
            role: "user".into(),
            content: vec![json!({ "type": "text", "text": transcript })],
        }],
        tools: Vec::new(),
    };
    let cancel = Cancel::new();
    let reply = state.llm.send(request, &cancel).await.ok()?;
    let summary = text_content(&reply.content).trim().to_string();
    if summary.is_empty() {
        return None;
    }
    let after = rough_text_tokens(&summary);
    Some(Compacted {
        summary,
        through_seq: events[..split].last().map_or(0, |event| event.seq),
        tokens_before: before,
        tokens_after: after,
    })
}

fn rough_tokens(messages: &[LlmMessage]) -> usize {
    messages
        .iter()
        .flat_map(|message| message.content.iter())
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .map(rough_text_tokens)
        .sum()
}

fn rough_text_tokens(text: &str) -> usize {
    // Rough on purpose: three characters per token is conservative for Thai and
    // English, and needs no Provider tokenizer (ADR 0041).
    text.chars().count().div_ceil(3)
}

fn transcript_text(messages: &[LlmMessage]) -> String {
    let mut text = String::new();
    for message in messages {
        let content = text_content(&message.content);
        if content.is_empty() {
            continue;
        }
        text.push_str(&message.role);
        text.push_str(": ");
        text.push_str(&content);
        text.push_str("\n\n");
        if text.chars().count() >= 100_000 {
            text.push_str("(Transcript truncated before summarization.)");
            break;
        }
    }
    text
}

fn text_content(content: &[Value]) -> String {
    content
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A tool call outside the Allowlist waits for an Approval first. `bash` matches
/// by command prefix; any other tool matches by its exact name. The file tools
/// never wait: the sandbox holds them already (ADR 0008, 0030).
async fn run_tool(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    name: &str,
    input: &Value,
    cancel: &Cancel,
) -> Result<String, ToolError> {
    let allowlist = state.allowlist();
    if name == "bash" {
        let command = input.get("command").and_then(Value::as_str);
        let Some(command) = command else {
            return state.tools.run(name, input, cancel).await;
        };
        if matches_allowlist(command, &allowlist) {
            return state.tools.run(name, input, cancel).await;
        }
        let answer = ask_approval(
            state,
            task,
            starter,
            command,
            split_command(command),
            cancel,
        )
        .await;
        if answer.decision == ApprovalDecision::Approve {
            return state.tools.run(name, input, cancel).await;
        }
        return Err(denial(&answer));
    }
    if FILE_TOOL_NAMES.contains(&name) || allowlist.iter().any(|entry| entry == name) {
        return state.tools.run(name, input, cancel).await;
    }
    let answer = ask_approval(state, task, starter, name, vec![name.to_string()], cancel).await;
    if answer.decision == ApprovalDecision::Approve {
        return state.tools.run(name, input, cancel).await;
    }
    Err(denial(&answer))
}

async fn ask_approval(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    command: &str,
    parts: Vec<String>,
    cancel: &Cancel,
) -> Answer {
    let request = request_id(state);
    let timeout = state.approval_timeout();
    let expires_at = now_ms() + timeout.as_millis() as i64;
    let _ = state.append(
        task,
        starter,
        "approval.requested",
        json!({ "request": request, "command": command, "parts": parts, "expiresAt": expires_at }),
        None,
    );

    let (answer, answered) = oneshot::channel();
    state.waiting.lock().expect("waiting").insert(
        request.clone(),
        Waiter {
            task: task.to_string(),
            starter: starter.to_string(),
            answer,
        },
    );

    enum Settled {
        Answered(Answer),
        Expired,
        Stopped,
    }

    let settled = tokio::select! {
        biased;
        // A stopped Turn does not keep waiting for an answer, and writes no
        // answer of its own (ADR 0017, 0033).
        _ = cancel.cancelled() => Settled::Stopped,
        answer = answered => match answer {
            Ok(answer) => Settled::Answered(answer),
            Err(_) => Settled::Stopped,
        },
        _ = tokio::time::sleep(timeout) => Settled::Expired,
    };

    let still_waiting = state
        .waiting
        .lock()
        .expect("waiting")
        .remove(&request)
        .is_some();
    match settled {
        Settled::Answered(answer) => answer,
        Settled::Stopped => Answer {
            request,
            decision: ApprovalDecision::Deny,
            message: Some("the Turn was stopped".into()),
        },
        Settled::Expired => {
            if still_waiting {
                let _ = state.append(
                    task,
                    starter,
                    "approval.answered",
                    json!({
                        "request": request,
                        "decision": "deny",
                        "message": "expired without an answer",
                    }),
                    None,
                );
            }
            Answer {
                request,
                decision: ApprovalDecision::Deny,
                message: Some("expired without an answer".into()),
            }
        }
    }
}

fn denial(answer: &Answer) -> ToolError {
    match answer.decision {
        ApprovalDecision::Redirect => {
            let instead = answer
                .message
                .as_ref()
                .map(|message| format!(" and asked for something else instead: {message}"))
                .unwrap_or_default();
            ToolError::Failed(format!(
                "the owner did not approve this{instead}, so it did not run (approval {})",
                answer.request
            ))
        }
        _ if answer.message.as_deref() == Some("expired without an answer") => ToolError::Failed(
            format!(
                "approval {} expired without an answer, so it did not run",
                answer.request
            ),
        ),
        _ => ToolError::Failed(format!(
            "the owner denied approval {}, so it did not run",
            answer.request
        )),
    }
}

fn request_id(state: &State) -> String {
    let count = state.approvals.fetch_add(1, Ordering::SeqCst) + 1;
    format!(
        "ap_{}_{}_{}",
        base36(now_ms() as u64),
        base36(count),
        base36(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.subsec_nanos() as u64)
            .unwrap_or_default())
    )
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 is ascii")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}
