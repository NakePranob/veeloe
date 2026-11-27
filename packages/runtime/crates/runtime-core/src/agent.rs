//! One Agent: Turns of different Tasks run at once and wait only to write
//! (ADR 0080); a Task's own Turns run one after another. Each is in the name of
//! the Member who sent its message (ADR 0010). Everything it does is an event in the log first,
//! and every event goes to the Member who started the Task.
//!
//! Ported from `packages/runtime-legacy/src/worker/core/agent.ts`. The Stop and
//! Approval semantics are the same: a Stop ends the Turn as `stopped` and cuts
//! what it holds (ADR 0017), an Approval waits an hour and then counts as
//! denied (ADR 0030), and the file tools never wait because the sandbox holds
//! them already.

use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use veeloe_plugin_api::{
    with_progress, with_turn, Cancel, PluginError, Progress, ToolDefinition, ToolError,
    ToolRegistry,
};
use veeloe_protocol::{matches_allowlist, split_command};

use crate::conversation::conversation;
use crate::event_store::{Clock, EventLog, EventStore, StoreError, SystemClock, TaskEvent};
use crate::ipc::{ApprovalDecision, FromWorker, SupervisorLink, ToWorker, TriggerRun};
use crate::ports::{Llm, LlmError, LlmMessage, LlmRequest};
use crate::write_lock::{Class, WriteLock};

/// How many times one Turn may go back to the LLM, so a tool loop cannot run all night.
pub const MAX_ROUNDS: usize = 50;

/// The tools that read and write the Workdir: the sandbox holds them, never the
/// Allowlist (`file-tools`, ADR 0030).
const FILE_TOOL_NAMES: [&str; 7] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "send_file",
    "memory",
];

/// How long one Approval waits for an answer before it counts as denied
/// (ADR 0030 proposes an hour).
pub const APPROVAL_TIMEOUT_MS: u64 = 3_600_000;

/// Stop ids already obeyed: the same command sent again stops nothing twice.
/// The oldest fall away.
const STOPPED_IDS_KEPT: usize = 100;
/// How long a Turn may go with no event and no command output before it is
/// written down as stalled (ADR 0073).
const STALL_AFTER_MS: u64 = 5 * 60 * 1000;
/// How much of a running command's output, from its end, goes out live, and how often.
const OUTPUT_TAIL: usize = 2048;
const OUTPUT_EVERY: Duration = Duration::from_secs(1);

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
    /// Started by a Trigger rather than a person: it waits behind people for the
    /// write lock (ADR 0080).
    background: bool,
    /// When this Turn last did anything: an event, or command output.
    activity: Mutex<Instant>,
    /// This Turn's current quiet stretch is already written down as stalled.
    stalled: AtomicBool,
    /// Waits on a person (an Approval) or on the write lock: not a stall.
    waiting: AtomicUsize,
    /// What this Turn's network requests carry, so the proxy knows whose they are.
    token: String,
}

impl RunningTurn {
    fn touch(&self) {
        *self.activity.lock().expect("activity") = Instant::now();
        self.stalled.store(false, Ordering::SeqCst);
    }
}

/// Which Tasks have a Turn running or starting, and what waits behind each.
#[derive(Default)]
struct Tasks {
    busy: HashSet<String>,
    queued: HashMap<String, VecDeque<ToWorker>>,
}

#[derive(Debug)]
struct Waiter {
    task: String,
    starter: String,
    answer: oneshot::Sender<Answer>,
}

/// One Question a Card asked: only `member`, who sent the Turn's message, may answer it.
#[derive(Debug)]
struct Question {
    task: String,
    starter: String,
    member: String,
    answer: oneshot::Sender<Value>,
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
    /// The Task log, written and read through one owner (ADR 0020, 0069).
    log: Arc<dyn EventLog>,
    llm: Arc<dyn Llm>,
    tools: Arc<ToolRegistry>,
    link: Arc<dyn SupervisorLink>,
    clock: RwLock<Arc<dyn Clock + Send + Sync>>,
    allowlist: RwLock<Vec<String>>,
    /// The file level this worker's sandbox was started with (ADR 0087).
    files: RwLock<Files>,
    approval_timeout_ms: AtomicU64,
    /// The Turns running now, one per Task at most.
    running: Mutex<HashMap<String, Arc<RunningTurn>>>,
    /// Messages for a Task whose Turn has not ended, in arrival order.
    tasks: Mutex<Tasks>,
    /// Who may write the Workdir now (ADR 0080).
    write_lock: WriteLock,
    /// `MEMORY.md` and the daily notes: held only while one write lands.
    memory_lock: tokio::sync::Mutex<()>,
    stopped_ids: Mutex<VecDeque<String>>,
    waiting: Mutex<HashMap<String, Waiter>>,
    /// Questions a Card asked, waiting for the Turn's Member to answer (ADR 0082).
    questions: Mutex<HashMap<String, Question>>,
    approvals: AtomicU64,
    max_rounds: AtomicUsize,
    context_window: AtomicUsize,
    turns: Mutex<Vec<JoinHandle<()>>>,
    /// Naming a Task after its first Turn that ends `done`: beside the queue, not in it.
    titling: Mutex<Vec<JoinHandle<()>>>,
    stall_after_ms: AtomicU64,
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
        let event = self.log().record(task, starter, kind, &body, message_id)?;
        // Any event but the stall itself ends a quiet stretch.
        if kind != "turn.stalled" {
            self.touch(task);
        }
        self.link.send(FromWorker::Event {
            task: task.to_string(),
            starter: starter.to_string(),
            event: event.clone(),
        });
        Ok(event)
    }

    /// The Task's Turn just did something, so it is not stalled.
    fn touch(&self, task: &str) {
        if let Some(turn) = self.turn_of(task) {
            turn.touch();
        }
    }

    fn turn_of(&self, task: &str) -> Option<Arc<RunningTurn>> {
        self.running.lock().expect("running").get(task).cloned()
    }

    fn log(&self) -> Arc<dyn EventLog> {
        Arc::clone(&self.log)
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
        let log: Arc<dyn EventLog> = Arc::new(Mutex::new(store));
        Self::over_log(name, log, llm, tools, link)
    }

    /// An Agent whose log lives elsewhere: a worker's handle on the supervisor's
    /// log, which is the only writer (ADR 0020, 0069).
    pub fn over_log(
        name: impl Into<String>,
        log: Arc<dyn EventLog>,
        llm: Arc<dyn Llm>,
        tools: ToolRegistry,
        link: Arc<dyn SupervisorLink>,
    ) -> Self {
        Self {
            state: Arc::new(State {
                name: RwLock::new(name.into()),
                workdir: Mutex::new(None),
                log,
                llm,
                tools: Arc::new(tools),
                link,
                clock: RwLock::new(Arc::new(SystemClock)),
                allowlist: RwLock::new(Vec::new()),
                files: RwLock::new(Files::Folder),
                approval_timeout_ms: AtomicU64::new(APPROVAL_TIMEOUT_MS),
                running: Mutex::new(HashMap::new()),
                tasks: Mutex::new(Tasks::default()),
                write_lock: WriteLock::default(),
                memory_lock: tokio::sync::Mutex::new(()),
                stopped_ids: Mutex::new(VecDeque::new()),
                waiting: Mutex::new(HashMap::new()),
                questions: Mutex::new(HashMap::new()),
                approvals: AtomicU64::new(0),
                max_rounds: AtomicUsize::new(MAX_ROUNDS),
                context_window: AtomicUsize::new(128_000),
                turns: Mutex::new(Vec::new()),
                titling: Mutex::new(Vec::new()),
                stall_after_ms: AtomicU64::new(STALL_AFTER_MS),
            }),
        }
    }

    pub fn with_max_rounds(self, max_rounds: usize) -> Self {
        self.state.max_rounds.store(max_rounds, Ordering::SeqCst);
        self
    }

    /// Pin this Workdir's `MEMORY.md` into each new Turn (ADR 0036).
    /// How long a quiet Turn waits before `turn.stalled`; tests make it short.
    pub fn with_stall_after(self, after: Duration) -> Self {
        self.state
            .stall_after_ms
            .store(after.as_millis() as u64, Ordering::SeqCst);
        self
    }

    pub fn with_workdir(self, workdir: impl Into<PathBuf>) -> Self {
        *self.state.workdir.lock().expect("workdir") = Some(workdir.into());
        self
    }

    /// The clock the core reads "now" from; the Machine's own unless a test
    /// gives another (ADR 0022).
    pub fn with_clock(self, clock: Arc<dyn Clock + Send + Sync>) -> Self {
        *self.state.clock.write().expect("clock") = clock;
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
    /// The file level the supervisor started this worker's sandbox with.
    pub fn set_files(&self, files: Files) {
        *self.state.files.write().expect("files") = files;
    }

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
        Ok(self.state.log().events(task, 0)?)
    }

    /// Everything the supervisor says to this worker, synchronous up to the
    /// start of a Turn, so two messages can never both find the same Task free.
    pub fn receive(&self, message: ToWorker) -> Result<(), AgentError> {
        match message {
            ToWorker::List { member } => self.list(&member),
            ToWorker::Stop {
                task,
                id,
                member,
                reference,
            } => self.stop(&task, &id, &member, &reference),
            ToWorker::Retitle {
                task,
                title,
                member,
                reference,
            } => self.retitle(&task, &title, &member, &reference),
            ToWorker::TitleTrigger { id, text } => {
                tokio::spawn(title_trigger(Arc::clone(&self.state), id, text));
                Ok(())
            }
            ToWorker::Approval {
                request,
                decision,
                message,
                member,
                reference,
                task,
            } => self.answer_approval(
                &request,
                decision,
                message,
                &member,
                &reference,
                task.as_deref(),
            ),
            ToWorker::CardAnswer {
                task,
                id,
                answer,
                member,
                reference,
            } => self.answer_card(&task, &id, answer, &member, &reference),
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
            // So does the supervisor's word on the log it owns.
            ToWorker::LogAppended { .. }
            | ToWorker::LogFailed { .. }
            | ToWorker::LogAnswer { .. } => Ok(()),
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
            } => self.message(&task, &id, &member, &text, &reference, false, None),
            ToWorker::Run {
                task,
                member,
                text,
                trigger,
            } => {
                // One id per round, so a resend of the same round is one message.
                let id = format!("trigger:{}:{}", trigger.id, trigger.at);
                self.message(&task, &id, &member, &text, "", false, Some(&trigger))
            }
        }
    }

    fn list(&self, member: &str) -> Result<(), AgentError> {
        let tasks = self.state.log().tasks_started_by(member)?;
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
        let starter = self.state.log().starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                return self.refuse(member, reference, "task.not_found", Some(task));
            }
        }
        if starter.is_none() {
            return self.refuse(member, reference, "task.not_found", Some(task));
        }
        let events = self.state.log().events(task, after)?;
        self.state.link.send(FromWorker::Events {
            task: task.to_string(),
            member: member.to_string(),
            events,
        });
        Ok(())
    }

    /// A message for a Task: it waits behind that Task's running Turn, and
    /// starts at once otherwise, whatever other Tasks are doing (ADR 0080).
    #[allow(clippy::too_many_arguments)]
    fn message(
        &self,
        task: &str,
        id: &str,
        member: &str,
        text: &str,
        reference: &str,
        from_queue: bool,
        trigger: Option<&TriggerRun>,
    ) -> Result<(), AgentError> {
        if !from_queue {
            let mut tasks = self.state.tasks.lock().expect("tasks");
            if tasks.busy.contains(task) {
                tasks
                    .queued
                    .entry(task.to_string())
                    .or_default()
                    .push_back(match trigger {
                        Some(trigger) => ToWorker::Run {
                            task: task.to_string(),
                            member: member.to_string(),
                            text: text.to_string(),
                            trigger: trigger.clone(),
                        },
                        None => ToWorker::Message {
                            task: task.to_string(),
                            id: id.to_string(),
                            member: member.to_string(),
                            text: text.to_string(),
                            reference: reference.to_string(),
                        },
                    });
                return Ok(());
            }
            tasks.busy.insert(task.to_string());
        }
        // The Task is reserved: anything that ends here without a Turn hands it on.
        let started = self.begin(task, id, member, text, reference, trigger);
        if !matches!(started, Ok(true)) {
            release(Arc::clone(&self.state), task);
        }
        started.map(|_| ())
    }

    /// Starts the Turn of a reserved Task. True when a Turn is now running.
    fn begin(
        &self,
        task: &str,
        id: &str,
        member: &str,
        text: &str,
        reference: &str,
        trigger: Option<&TriggerRun>,
    ) -> Result<bool, AgentError> {
        let starter = self.state.log().starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                self.refuse(member, reference, "task.not_found", Some(task))?;
                return Ok(false);
            }
        }
        if self.state.log().has_message(id)? {
            return Ok(false); // a resend: it is in the log already
        }
        let owner = starter.unwrap_or_else(|| member.to_string());
        self.state.append(
            task,
            &owner,
            "member.message",
            with_trigger(json!({ "member": member, "id": id, "text": text }), trigger),
            Some(id),
        )?;

        // Once per Turn: a rename reaches the next Turn, never one halfway
        // through. Both are written here, before the Turn task is spawned, so a
        // Stop that arrives at once still lands after the start.
        let mut system = format!(
            "You are {}, an Agent that runs on its owner's own machine through Veeloe. Answer in the language the person writes in.\n\n{}",
            self.state.name.read().expect("name"),
            crate::UNTRUSTED_NOTE
        );
        if let Some(workdir) = self.state.workdir.lock().expect("workdir").as_ref() {
            // Name the file and where it lives on every Turn, even before it exists:
            // without this the model invents its own notes (a `memory/` folder), and
            // none of that is pinned into the next Turn (ADR 0036).
            system.push_str(
                "\n\nMemory: keep what every Task needs in MEMORY.md at the root of your Workdir, \
                 writing it with the `memory` tool; use scope \"today\" for notes that are not for \
                 every Task. MEMORY.md is pinned into every new Turn, capped at 4,000 characters, \
                 so keep it short and current.",
            );
            let memory = crate::memory::memory_prompt(workdir);
            if !memory.is_empty() {
                // The Agent writes MEMORY.md itself, maybe from a page it read: data, not orders (#67).
                system.push_str("\n\nMEMORY.md as it is now:\n");
                system.push_str(&crate::untrusted("memory", &memory));
            }
        }
        self.state.append(
            task,
            &owner,
            "turn.started",
            with_trigger(
                json!({ "member": member, "files": turn_files(*self.state.files.read().expect("files"), member, trigger).as_str() }),
                trigger,
            ),
            None,
        )?;
        let trigger = trigger.cloned();

        let cancel = Cancel::new();
        let turn = Arc::new(RunningTurn {
            task: task.to_string(),
            starter: owner.clone(),
            cancel: cancel.clone(),
            background: trigger.is_some(),
            activity: Mutex::new(Instant::now()),
            stalled: AtomicBool::new(false),
            waiting: AtomicUsize::new(0),
            token: turn_token(),
        });
        self.state
            .running
            .lock()
            .expect("running")
            .insert(task.to_string(), Arc::clone(&turn));
        // Before any tool can reach the proxy, so it knows this Turn's requests.
        self.state.link.send(FromWorker::TurnProxy {
            task: task.to_string(),
            token: turn.token.clone(),
        });
        tokio::spawn(watch_stall(Arc::clone(&self.state), turn));

        let state = Arc::clone(&self.state);
        let started = task.to_string();
        let handle = tokio::spawn(async move {
            let failed = run_turn(
                Arc::clone(&state),
                started.clone(),
                owner.clone(),
                system,
                cancel,
                trigger,
            )
            .await
            .is_err();
            state.running.lock().expect("running").remove(&started);
            // Whatever ended the Turn, it no longer writes (ADR 0080).
            state.write_lock.release(&started);
            // The answer is already written; the name comes after it, and the
            // next Turn does not wait for it.
            let titling = tokio::spawn(title_task(
                Arc::clone(&state),
                started.clone(),
                owner.clone(),
            ));
            state.titling.lock().expect("titling").push(titling);
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
            release(state, &started);
        });
        self.state.turns.lock().expect("turns").push(handle);
        Ok(true)
    }

    fn stop(&self, task: &str, id: &str, member: &str, reference: &str) -> Result<(), AgentError> {
        if self
            .state
            .stopped_ids
            .lock()
            .expect("stopped ids")
            .contains(&id.to_string())
        {
            return Ok(());
        }
        let starter = self.state.log().starter_of(task)?;
        if let Some(starter) = starter.as_deref() {
            if starter != member {
                return self.refuse(member, reference, "task.not_found", Some(task));
            }
        }
        let Some(turn) = self.state.turn_of(task) else {
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

    /// The Member who started the Task names it; anyone else, or a Task that is
    /// not there, hears `task.not_found`, as with Stop.
    fn retitle(
        &self,
        task: &str,
        title: &str,
        member: &str,
        reference: &str,
    ) -> Result<(), AgentError> {
        let starter = self.state.log().starter_of(task)?;
        if starter.as_deref() != Some(member) {
            return self.refuse(member, reference, "task.not_found", Some(task));
        }
        let title = clean_title(title);
        if title.is_empty() {
            return Ok(());
        }
        self.state.append(
            task,
            member,
            "task.titled",
            json!({ "title": title, "member": member }),
            None,
        )?;
        Ok(())
    }

    /// A Member answered a Question (ADR 0082): written to the Task, then handed to
    /// the waiting tool. Only the Turn's own Member may answer, and only while it waits.
    fn answer_card(
        &self,
        task: &str,
        id: &str,
        answer: Value,
        member: &str,
        reference: &str,
    ) -> Result<(), AgentError> {
        let mut questions = self.state.questions.lock().expect("questions");
        let fits = questions
            .get(id)
            .is_some_and(|question| question.task == task && question.member == member);
        if !fits {
            drop(questions);
            return self.refuse(member, reference, "card.unknown", Some(task));
        }
        let question = questions.remove(id).expect("checked above");
        drop(questions);
        self.state.append(
            &question.task,
            &question.starter,
            "card.answered",
            json!({ "id": id, "member": member, "answer": answer }),
            None,
        )?;
        let _ = question.answer.send(answer);
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
        self.state.append(
            &waiter.task,
            &waiter.starter,
            "approval.answered",
            body,
            None,
        )?;
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

    /// Resolves when every Turn, the ones they started from a queue included,
    /// has ended, and each Task they may have named has its name.
    pub async fn idle(&self) {
        loop {
            let handles: Vec<_> = self.state.turns.lock().expect("turns").drain(..).collect();
            let titling: Vec<_> = self
                .state
                .titling
                .lock()
                .expect("titling")
                .drain(..)
                .collect();
            if handles.is_empty() && titling.is_empty() {
                return;
            }
            for handle in handles.into_iter().chain(titling) {
                let _ = handle.await;
            }
        }
    }

    /// Every Turn still open when this worker last ended is closed as
    /// interrupted, and nothing is made to run again (ADR 0033). Called once, as
    /// the worker starts.
    pub fn close_open_turns(&self) -> Result<(), AgentError> {
        let open = self.state.log().open_turns()?;
        for task in open {
            let Some(starter) = self.state.log().starter_of(&task)? else {
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
    trigger: Option<TriggerRun>,
) -> Result<(), AgentError> {
    let rounds = state.max_rounds.load(Ordering::SeqCst);
    let mut tools = state.tools.definitions();
    // Any Turn may put a piece of work on its Agent's Idle Work draft (ADR 0056).
    tools.push(propose_idle_work());
    let from_trigger = trigger.is_some();
    // One piece of Idle Work has a time limit: past it the Turn ends as a Stop would.
    let timed_out = Arc::new(AtomicBool::new(false));
    if let Some(limit) = trigger.as_ref().and_then(|trigger| trigger.limit_s) {
        let (cancel, timed_out) = (cancel.clone(), Arc::clone(&timed_out));
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(limit)).await;
            if !cancel.is_cancelled() {
                timed_out.store(true, Ordering::SeqCst);
                cancel.cancel();
            }
        });
    }
    // Only a round nobody asked for may end with nothing to say (issue #56).
    if from_trigger {
        tools.push(nothing_to_report());
    }
    // A Schedule with a goal carries its progress across rounds and ends itself (ADR 0085).
    let goal = trigger.as_ref().is_some_and(|trigger| trigger.goal);
    if goal {
        tools.push(goal_note());
        tools.push(goal_met());
    }
    // An Agent that reaches past its own folder may narrow itself, never widen (ADR 0087).
    let files = *state.files.read().expect("files");
    if files != Files::Folder {
        tools.push(files_narrow(files));
    }
    // A round nobody watches asks no one: its Schedule's scope is all it adds (ADR 0079).
    let unattended = trigger
        .as_ref()
        .filter(|trigger| !trigger.attended)
        .map(|trigger| trigger.allow.clone());
    // Somebody is there to answer: the Agent may ask a Question with a Card (ADR 0082).
    if unattended.is_none() {
        tools.push(crate::cards::ask_choice());
        tools.push(crate::cards::ask_form());
    }
    for _ in 0..rounds {
        let mut events = state.log().events(&task, 0)?;
        if let Some(summary) = compact_if_needed(&state, &task, &starter, &events).await {
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
                events = state.log().events(&task, 0)?;
            }
        }
        let request = LlmRequest {
            task: task.clone(),
            system: system.clone(),
            messages: conversation(&events),
            tools: tools.clone(),
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
                "parts": context_parts(&request),
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
            return end(&state, &task, &starter, "stopped", time_limit(&timed_out));
        };
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                if cancel.is_cancelled() {
                    return end(&state, &task, &starter, "stopped", time_limit(&timed_out));
                }
                let code = if error.code().is_empty() {
                    "provider.failed"
                } else {
                    error.code()
                };
                let mut body = json!({ "reason": "error", "code": code });
                if let LlmError::RateLimited(Some(seconds)) = error {
                    body["retryAfter"] = json!(seconds);
                }
                state.append(&task, &starter, "turn.ended", body, None)?;
                return Ok(());
            }
        };
        // An answer that arrived after the Stop is not the Turn's answer: it is
        // dropped, not written.
        if cancel.is_cancelled() {
            return end(&state, &task, &starter, "stopped", time_limit(&timed_out));
        }
        state.append(
            &task,
            &starter,
            "llm.message",
            json!({ "content": reply.content }),
            None,
        )?;

        let uses: Vec<&Value> = reply
            .content
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
            .collect();
        if reply.stop_reason.as_deref() != Some("tool_use") || uses.is_empty() {
            return end(&state, &task, &starter, "done", None);
        }

        let mut results = Vec::new();
        // Where `nothing_to_report` answered in this reply, if it did.
        let mut quiet_at = None;
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
            let result = if name == PROPOSE_IDLE_WORK {
                propose(&state, &input)
            } else if unattended.is_none()
                && (name == crate::cards::ASK_CHOICE || name == crate::cards::ASK_FORM)
            {
                ask_card(&state, &task, &starter, &events, name, &input, &cancel).await
            } else if goal && (name == GOAL_NOTE || name == GOAL_MET) {
                goal_event(&state, &task, &starter, name, &input)
            } else if files != Files::Folder && name == FILES_NARROW {
                narrow_files(&state, &task, &starter, files, &input)
            } else if from_trigger && name == NOTHING_TO_REPORT {
                quiet_at = Some(results.len());
                Ok("This round ends quietly: nobody is told.".to_string())
            } else if !state.tools.has(name) {
                Err(ToolError::Unknown(name.to_string()))
            } else {
                let unattended = unattended.as_deref();
                run_tool(
                    &state, &task, &starter, id, name, &input, &cancel, unattended,
                )
                .await
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
            return end(&state, &task, &starter, "stopped", time_limit(&timed_out));
        }
        // Decided once every call of the reply has run: a command refused after
        // `nothing_to_report`, or a domain the proxy refused, is news too (ADR 0079).
        let mut quiet = false;
        if let Some(index) = quiet_at {
            if skipped_this_turn(&state, &task)? {
                results[index]["content"] = json!("something this round needed did not run, so it cannot end quietly: tell the owner what you needed and why");
                results[index]["is_error"] = json!(true);
            } else {
                quiet = true;
            }
        }
        state.append(
            &task,
            &starter,
            "tool.result",
            json!({ "content": results }),
            None,
        )?;
        if quiet {
            return end(&state, &task, &starter, "quiet", None);
        }
    }

    end(
        &state,
        &task,
        &starter,
        "error",
        Some("turn.too_many_rounds"),
    )
}

/// A Task's Turn ended, or never started: the next message of that Task starts,
/// and with none waiting the Task is free. Other Tasks are not touched.
fn release(state: Arc<State>, task: &str) {
    loop {
        let next = {
            let mut tasks = state.tasks.lock().expect("tasks");
            let next = tasks.queued.get_mut(task).and_then(VecDeque::pop_front);
            if tasks.queued.get(task).is_some_and(VecDeque::is_empty) {
                tasks.queued.remove(task);
            }
            if next.is_none() {
                tasks.busy.remove(task);
            }
            next
        };
        let Some(next) = next else {
            return;
        };
        let core = AgentCore {
            state: Arc::clone(&state),
        };
        let started = match next {
            ToWorker::Message {
                task,
                id,
                member,
                text,
                reference,
            } => core.begin(&task, &id, &member, &text, &reference, None),
            ToWorker::Run {
                task,
                member,
                text,
                trigger,
            } => {
                let id = format!("trigger:{}:{}", trigger.id, trigger.at);
                core.begin(&task, &id, &member, &text, "", Some(&trigger))
            }
            _ => Ok(false),
        };
        match started {
            // That Turn's own end hands the Task on.
            Ok(true) => return,
            Ok(false) => {}
            // The message was already popped; say so without its text and keep the queue moving.
            Err(error) => eprintln!("queued message failed: {error}"),
        }
    }
}

const NOTHING_TO_REPORT: &str = "nothing_to_report";

const PROPOSE_IDLE_WORK: &str = "propose_idle_work";
const GOAL_NOTE: &str = "goal_note";
const GOAL_MET: &str = "goal_met";
/// A progress note is at most this long; the next round reads it back (ADR 0085).
const GOAL_NOTE_MAX: usize = 2000;

fn goal_note() -> ToolDefinition {
    ToolDefinition {
        name: GOAL_NOTE.into(),
        description: "Saves where this Schedule's goal stands, for its next round to read: what you checked, what changed, what is left. The new note replaces the old one; at most 2000 characters.".into(),
        input_schema: json!({ "type": "object", "properties": { "note": { "type": "string" } }, "required": ["note"] }),
    }
}

fn goal_met() -> ToolDefinition {
    ToolDefinition {
        name: GOAL_MET.into(),
        description: "Says this Schedule's goal is met, with the reason the owner will read: the Schedule stops and no round runs again until they resume it. Call it only when the goal is plainly met.".into(),
        input_schema: json!({ "type": "object", "properties": { "reason": { "type": "string" } }, "required": ["reason"] }),
    }
}

/// `goal.noted` or `goal.met` in the round's Task: the supervisor keeps the note or stops the Schedule.
fn goal_event(
    state: &State,
    task: &str,
    starter: &str,
    name: &str,
    input: &Value,
) -> Result<String, ToolError> {
    let field = if name == GOAL_NOTE { "note" } else { "reason" };
    let text = input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if text.is_empty() || text.chars().count() > GOAL_NOTE_MAX {
        return Err(ToolError::Failed(format!(
            "{field}: 1 to {GOAL_NOTE_MAX} characters"
        )));
    }
    let kind = if name == GOAL_NOTE {
        "goal.noted"
    } else {
        "goal.met"
    };
    state
        .append(task, starter, kind, json!({ field: text }), None)
        .map_err(|error| ToolError::Failed(error.to_string()))?;
    Ok(if name == GOAL_NOTE {
        "Noted. The next round reads it.".into()
    } else {
        "The Schedule stops here; its owner is told why.".into()
    })
}

const FILES_NARROW: &str = "files_narrow";

impl Files {
    /// How far it reaches: a level may only move to a smaller one.
    fn reach(self) -> u8 {
        match self {
            Files::Folder => 0,
            Files::Selected => 1,
            Files::Machine => 2,
        }
    }
}

fn files_narrow(current: Files) -> ToolDefinition {
    let narrower: Vec<&str> = [Files::Folder, Files::Selected]
        .into_iter()
        .filter(|level| level.reach() < current.reach())
        .map(Files::as_str)
        .collect();
    ToolDefinition {
        name: FILES_NARROW.into(),
        description: format!(
            "Narrows which of the Machine's files you reach, now set to {}: \"folder\" keeps you to your own Workdir, \"selected\" to the folders the owner gave you. Use it before work that does not need more, such as reading pages from the web. It cannot widen: only your owner can. It takes effect once the work running now ends.",
            current.as_str()
        ),
        input_schema: json!({ "type": "object", "properties": { "files": { "type": "string", "enum": narrower } }, "required": ["files"] }),
    }
}

/// `files.narrowed` in the Task: the supervisor keeps the narrower level and
/// starts the worker again with it once the Turn ends (ADR 0087).
fn narrow_files(
    state: &State,
    task: &str,
    starter: &str,
    current: Files,
    input: &Value,
) -> Result<String, ToolError> {
    let asked = input
        .get("files")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let next = Files::parse(asked);
    if asked != next.as_str() || next.reach() >= current.reach() {
        return Err(ToolError::Failed(format!(
            "files: only narrower than {} (an Agent never widens itself)",
            current.as_str()
        )));
    }
    state
        .append(
            task,
            starter,
            "files.narrowed",
            json!({ "files": next.as_str() }),
            None,
        )
        .map_err(|error| ToolError::Failed(error.to_string()))?;
    Ok(format!(
        "Narrowed to {}. It takes effect once the work running now ends.",
        next.as_str()
    ))
}

fn propose_idle_work() -> ToolDefinition {
    ToolDefinition {
        name: PROPOSE_IDLE_WORK.into(),
        description: "Suggests work for your Idle Work list: things worth doing when nobody is asking for anything, such as tests that are missing or dependencies that are out of date. Each item is one instruction you would follow later on your own. Nothing runs until your owner reads the suggestions and signs them into the list.".into(),
        input_schema: json!({
            "type": "object",
            "properties": { "items": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 10 } },
            "required": ["items"],
        }),
    }
}

/// Sends what the Agent proposed to the supervisor, which keeps the draft.
fn propose(state: &State, input: &Value) -> Result<String, ToolError> {
    let items: Vec<String> = input
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(|item| item.chars().take(10_000).collect())
                .collect()
        })
        .unwrap_or_default();
    if items.is_empty() || items.len() > 10 {
        return Err(ToolError::Failed(
            "give 1 to 10 items, each a non-empty instruction".into(),
        ));
    }
    let count = items.len();
    state.link.send(FromWorker::IdleProposed { items });
    Ok(format!(
        "{count} item(s) proposed. Your owner reads them before anything runs."
    ))
}

/// The code a Stop carries when it was the round's time limit that stopped it.
fn time_limit(timed_out: &AtomicBool) -> Option<&'static str> {
    timed_out
        .load(Ordering::SeqCst)
        .then_some("trigger.time_limit")
}

fn nothing_to_report() -> ToolDefinition {
    ToolDefinition {
        name: NOTHING_TO_REPORT.into(),
        description: "Ends this scheduled round quietly when there is nothing the owner needs to hear: the Task does not show in their Inbox. Call it instead of writing that nothing changed.".into(),
        input_schema: json!({ "type": "object", "properties": {} }),
    }
}

/// Adds the Trigger a round came from, when it came from one.
/// How much of the Machine's files one Turn may reach (ADR 0087). Every Turn
/// takes its level from `turn_files`, so a wider level is decided in one place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Files {
    /// The Agent's Workdir, Projects and Library only (ADR 0068).
    Folder,
    /// Those, and folders on the Machine the Owner gave it (ADR 0087).
    Selected,
    /// Every file but the Runtime's own (ADR 0087).
    Machine,
}

impl Files {
    pub fn as_str(self) -> &'static str {
        match self {
            Files::Folder => "folder",
            Files::Selected => "selected",
            Files::Machine => "machine",
        }
    }

    /// The level the supervisor names; anything else is in-folder.
    pub fn parse(text: &str) -> Self {
        match text {
            "selected" => Files::Selected,
            "machine" => Files::Machine,
            _ => Files::Folder,
        }
    }
}

/// The level a Turn runs at: the Agent's own, which its worker's sandbox was
/// started with (ADR 0087). The starter and trigger are what the lock rules
/// read (#87).
pub fn turn_files(agent: Files, _member: &str, _trigger: Option<&TriggerRun>) -> Files {
    agent
}

fn with_trigger(mut body: Value, trigger: Option<&TriggerRun>) -> Value {
    if let Some(trigger) = trigger {
        body["trigger"] = json!({
            "kind": trigger.kind,
            "id": trigger.id,
            "at": trigger.at,
            "attended": trigger.attended,
        });
    }
    body
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
    starter: &str,
    events: &[TaskEvent],
) -> Option<Compacted> {
    // A tool round is not a safe split: its call would lose its result.
    if events
        .last()
        .is_some_and(|event| event.kind == "llm.message")
    {
        return None;
    }
    let window = state.context_window.load(Ordering::SeqCst);
    if window == 0 {
        return None;
    }
    // Keep the message that started this Turn outside the summary, so the
    // model still sees the exact request beside the summary.
    let split = if events
        .last()
        .is_some_and(|event| event.kind == "member.message")
    {
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
    // The one moment context is about to be lost: ask what belongs in Memory and
    // write it ourselves. One flush per compaction, and never one that blocks the
    // Turn (ADR 0017).
    if !flushed_since_compaction(events) {
        if let Some(chars) = flush_memory(state, task, &transcript).await {
            let _ = state.append(
                task,
                starter,
                "memory.saved",
                json!({ "chars": chars }),
                None,
            );
        }
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

/// Whether this compaction window already saved Memory. A summary that failed
/// leaves the window open, and the next loop must not append the same notes twice.
fn flushed_since_compaction(events: &[TaskEvent]) -> bool {
    events
        .iter()
        .rev()
        .take_while(|event| event.kind != "context.compacted")
        .any(|event| event.kind == "memory.saved")
}

/// How much one flush may add: the model is asked for a short note, and code keeps
/// it short even when the model writes an essay.
const FLUSH_MAX_CHARS: usize = 400;

/// Ask the model what must survive this Task, and write its answer into
/// `MEMORY.md` ourselves: the model owns the words, the Runtime owns the file and
/// the cap. `NO_REPLY`, an empty answer, a Provider failure or a write that would
/// pass the cap all mean "nothing saved", never a failed Turn.
async fn flush_memory(state: &Arc<State>, task: &str, transcript: &str) -> Option<usize> {
    let workdir = state.workdir.lock().expect("workdir").clone()?;
    let current = crate::memory::memory_prompt(&workdir);
    let mut asked = String::from(
        "What, from this Task, must every later Task know? Reply with only the new Markdown to          keep, at most 400 characters, or NO_REPLY when nothing qualifies. Never repeat what          MEMORY.md already says.",
    );
    if !current.is_empty() {
        asked.push_str("\n\nMEMORY.md now:\n");
        asked.push_str(&current);
    }
    asked.push_str("\n\nTask so far:\n");
    asked.push_str(transcript);
    let request = LlmRequest {
        task: task.to_string(),
        system: "You keep the durable memory of an AI Agent on its owner's own machine. Durable                  means agreements, stable preferences, and facts the owner already told the Agent;                  not progress, tool output, or anything only this Task needs."
            .into(),
        messages: vec![LlmMessage {
            role: "user".into(),
            content: vec![json!({ "type": "text", "text": asked })],
        }],
        tools: Vec::new(),
    };
    let reply = state.llm.send(request, &Cancel::new()).await.ok()?;
    let answer = text_content(&reply.content).trim().to_string();
    let first = answer.lines().next().unwrap_or_default().trim();
    if answer.is_empty() || first.eq_ignore_ascii_case("NO_REPLY") {
        return None;
    }
    // The prompt asks for 400 characters; take exactly that even when it forgets.
    let answer: String = answer.chars().take(FLUSH_MAX_CHARS).collect();
    let _memory = state.memory_lock.lock().await;
    crate::memory::write_memory(&workdir, &answer, crate::memory::Mode::Append).ok()
}

/// How long a Task's name may be: code holds it, whatever the model writes.
const TITLE_MAX_CHARS: usize = 60;
/// How much of each side of the conversation the namer sees.
const TITLE_SOURCE_CHARS: usize = 2_000;
const TITLE_SYSTEM: &str =
    "You name a conversation between a person and an AI Agent so the person can \
     tell it apart in a list. Reply with only the name: one line, at most 60 characters, in the \
     language the person wrote in, without quotes.";

/// The Turn that just ended is the Task's first to end `done`: the one moment a
/// Task is named. Read from the log, a failed try is never retried and needs no
/// memory of its own. A Task the Member already named keeps their name.
fn names_now(events: &[TaskEvent]) -> bool {
    let done = |event: &TaskEvent| {
        event.kind == "turn.ended"
            && event.body.get("reason").and_then(Value::as_str) == Some("done")
    };
    events.last().is_some_and(done)
        && events.iter().filter(|event| done(event)).count() == 1
        && !named(events)
}

fn named(events: &[TaskEvent]) -> bool {
    events.iter().any(|event| event.kind == "task.titled")
}

/// The model's answer as a name: its first line, without the quotes models like
/// to add, cut to the cap.
fn clean_title(answer: &str) -> String {
    let line = answer.trim().lines().next().unwrap_or_default();
    let line = line
        .trim()
        .trim_matches(|c| matches!(c, '"' | '\'' | '`' | '“' | '”' | '‘' | '’' | '«' | '»'))
        .trim();
    line.chars()
        .take(TITLE_MAX_CHARS)
        .collect::<String>()
        .trim_end()
        .to_string()
}

const TRIGGER_TITLE_SYSTEM: &str =
    "You name a scheduled instruction a person gave an AI Agent so they can tell it apart in a \
     list. Reply with only the name: one line, at most 60 characters, in the language the \
     instruction is written in, without quotes.";

/// Name a Schedule from its instruction. A Provider failure or an empty answer
/// sends nothing: the Controller shows the instruction itself instead.
async fn title_trigger(state: Arc<State>, id: String, text: String) {
    let request = LlmRequest {
        task: format!("trigger:{id}"),
        system: TRIGGER_TITLE_SYSTEM.into(),
        messages: vec![LlmMessage {
            role: "user".into(),
            content: vec![json!({
                "type": "text",
                "text": text.chars().take(TITLE_SOURCE_CHARS).collect::<String>(),
            })],
        }],
        tools: Vec::new(),
    };
    let Ok(reply) = state.llm.send(request, &Cancel::new()).await else {
        return;
    };
    let title = clean_title(&text_content(&reply.content));
    if !title.is_empty() {
        state.link.send(FromWorker::TriggerTitled { id, title });
    }
}

/// Name the Task from its first message and the answer that ended its first
/// `done` Turn. A Provider failure, a spent Budget or an empty answer leave it
/// unnamed; nothing here can fail a Turn.
async fn title_task(state: Arc<State>, task: String, starter: String) {
    let Ok(events) = state.log().events(&task, 0) else {
        return;
    };
    if !names_now(&events) {
        return;
    }
    let asked = events
        .iter()
        .find(|event| event.kind == "member.message")
        .and_then(|event| event.body.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let answered = events
        .iter()
        .rev()
        .find(|event| event.kind == "llm.message")
        .and_then(|event| event.body.get("content"))
        .and_then(Value::as_array)
        .map(|content| text_content(content))
        .unwrap_or_default();
    let cut = |text: &str| text.chars().take(TITLE_SOURCE_CHARS).collect::<String>();
    let request = LlmRequest {
        task: task.clone(),
        system: TITLE_SYSTEM.into(),
        messages: vec![LlmMessage {
            role: "user".into(),
            content: vec![json!({
                "type": "text",
                "text": format!("Person:\n{}\n\nAgent:\n{}", cut(asked), cut(&answered)),
            })],
        }],
        tools: Vec::new(),
    };
    let Ok(reply) = state.llm.send(request, &Cancel::new()).await else {
        return;
    };
    let title = clean_title(&text_content(&reply.content));
    // The Member may have named it while the model was thinking: theirs stays.
    let renamed = state
        .log()
        .events(&task, 0)
        .map(|events| named(&events))
        .unwrap_or(true);
    if !title.is_empty() && !renamed {
        let _ = state.append(
            &task,
            &starter,
            "task.titled",
            json!({ "title": title }),
            None,
        );
    }
}

const MEMORY_MARK: &str = "\n\nMEMORY.md as it is now:\n";
const SUMMARY_MARK: &str = "Summary of the earlier part of this Task:";

/// What each part of a request weighs, by the same rough count as `tokens`
/// (ADR 0041), so the Controller can show where the context goes. `tokens`
/// stays the measure compaction uses; these also count the system prompt, the
/// tool definitions and tool calls and results. A part that weighs nothing is
/// left out.
fn context_parts(request: &LlmRequest) -> Value {
    let (instructions, memory) = match request.system.split_once(MEMORY_MARK) {
        Some((before, after)) => (before, after),
        None => (request.system.as_str(), ""),
    };
    let tools: String = request
        .tools
        .iter()
        .map(|tool| format!("{}{}{}", tool.name, tool.description, tool.input_schema))
        .collect();
    let mut parts = [
        ("system", rough_text_tokens(instructions)),
        ("memory", rough_text_tokens(memory)),
        ("tools", rough_text_tokens(&tools)),
        ("summary", 0),
        ("you", 0),
        ("agent", 0),
        ("results", 0),
    ];
    let mut add = |part: &str, text: &str| {
        if let Some(slot) = parts.iter_mut().find(|(name, _)| *name == part) {
            slot.1 += rough_text_tokens(text);
        }
    };
    for message in &request.messages {
        for block in &message.content {
            let kind = block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let text = block
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match (message.role.as_str(), kind) {
                ("user", "text") if text.starts_with(SUMMARY_MARK) => add("summary", text),
                ("user", "text") => add("you", text),
                (_, "tool_result") => add(
                    "results",
                    &block
                        .get("content")
                        .map(Value::to_string)
                        .unwrap_or_default(),
                ),
                ("assistant", "tool_use") => add("agent", &block.to_string()),
                ("assistant", _) => add("agent", text),
                _ => add("you", &block.to_string()),
            }
        }
    }
    Value::Object(
        parts
            .into_iter()
            .filter(|(_, tokens)| *tokens > 0)
            .map(|(name, tokens)| (name.to_string(), json!(tokens)))
            .collect(),
    )
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
///
/// `unattended` is a round nobody watches: its Schedule's scope counts as
/// Allowlist too, and what is outside both is refused at once, written down as
/// `approval.skipped`, instead of waiting on nobody (ADR 0079).
#[allow(clippy::too_many_arguments)]
async fn run_tool(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    id: &str,
    name: &str,
    input: &Value,
    cancel: &Cancel,
    unattended: Option<&[String]>,
) -> Result<String, ToolError> {
    let mut allowlist = state.allowlist();
    if let Some(allow) = unattended {
        allowlist.extend(allow.iter().cloned());
    }
    if name == "bash" {
        let command = input.get("command").and_then(Value::as_str);
        let Some(command) = command else {
            return call_tool(state, task, starter, id, name, input, cancel).await;
        };
        if matches_allowlist(command, &allowlist) {
            return call_tool(state, task, starter, id, name, input, cancel).await;
        }
        if unattended.is_some() {
            return Err(skip(state, task, starter, command, split_command(command)));
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
            return call_tool(state, task, starter, id, name, input, cancel).await;
        }
        return Err(denial(&answer));
    }
    if FILE_TOOL_NAMES.contains(&name) || allowlist.iter().any(|entry| entry == name) {
        return call_tool(state, task, starter, id, name, input, cancel).await;
    }
    if unattended.is_some() {
        return Err(skip(state, task, starter, name, vec![name.to_string()]));
    }
    let answer = ask_approval(state, task, starter, name, vec![name.to_string()], cancel).await;
    if answer.decision == ApprovalDecision::Approve {
        return call_tool(state, task, starter, id, name, input, cancel).await;
    }
    Err(denial(&answer))
}

/// Runs one tool. A `bash` call's output also goes out live to whoever started
/// the Task (ADR 0073); the model still reads only the result.
async fn call_tool(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    id: &str,
    name: &str,
    input: &Value,
    cancel: &Cancel,
) -> Result<String, ToolError> {
    // Allowed by now; a write waits for the Workdir until it is this Turn's (ADR 0080).
    if writes(name, input) {
        let class = match state.turn_of(task) {
            Some(turn) if turn.background => Class::Background,
            _ => Class::Person,
        };
        let waiting = Waiting::on(state, task);
        let got = state.write_lock.acquire(task, class, cancel).await;
        drop(waiting);
        if !got {
            return Err(ToolError::Stopped);
        }
    }
    let token = state
        .turn_of(task)
        .map(|turn| turn.token.clone())
        .unwrap_or_default();
    if name == "memory" {
        // Two Turns writing memory at once each land whole.
        let _memory = state.memory_lock.lock().await;
        return with_turn(token, state.tools.run(name, input, cancel)).await;
    }
    if name != "bash" {
        return with_turn(token, state.tools.run(name, input, cancel)).await;
    }
    let sink = output_sink(
        Arc::clone(state),
        task.to_string(),
        starter.to_string(),
        id.to_string(),
    );
    with_turn(
        token,
        with_progress(sink, state.tools.run(name, input, cancel)),
    )
    .await
}

/// Whether this call writes the Workdir and so needs its lock: the file tools
/// that change files, and every command but the built-in ones of ADR 0075.
/// Reading, searching and every other tool never wait (ADR 0080).
fn writes(name: &str, input: &Value) -> bool {
    match name {
        "write" | "edit" => true,
        "bash" => input
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| !matches_allowlist(command, &[])),
        _ => false,
    }
}

/// Keeps the end of a command's output and sends it at most once a second.
/// Output keeps the Turn from counting as stalled.
fn output_sink(state: Arc<State>, task: String, starter: String, id: String) -> Progress {
    let started = Instant::now();
    let seen: Mutex<(Vec<u8>, u64, Option<Instant>)> = Mutex::new((Vec::new(), 0, None));
    Arc::new(move |chunk: &[u8]| {
        state.touch(&task);
        let mut seen = seen.lock().expect("output");
        seen.0.extend_from_slice(chunk);
        if seen.0.len() > OUTPUT_TAIL {
            let cut = seen.0.len() - OUTPUT_TAIL;
            seen.0.drain(..cut);
        }
        seen.1 += chunk.len() as u64;
        if seen.2.is_some_and(|at| at.elapsed() < OUTPUT_EVERY) {
            return;
        }
        seen.2 = Some(Instant::now());
        state.link.send(FromWorker::ToolOutput {
            task: task.clone(),
            starter: starter.clone(),
            tool_use_id: id.clone(),
            tail: String::from_utf8_lossy(&seen.0).into_owned(),
            bytes: seen.1,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    })
}

/// Writes `turn.stalled` once per quiet stretch of one running Turn: no event
/// and no output for the stall time, a wait on a person or on the write lock
/// aside (ADR 0073, 0080). Ends with the Turn.
async fn watch_stall(state: Arc<State>, turn: Arc<RunningTurn>) {
    loop {
        let after = Duration::from_millis(state.stall_after_ms.load(Ordering::SeqCst));
        tokio::time::sleep((after / 5).clamp(Duration::from_millis(10), Duration::from_secs(5)))
            .await;
        let still = state
            .turn_of(&turn.task)
            .is_some_and(|running| Arc::ptr_eq(&running, &turn));
        if !still {
            return;
        }
        if turn.waiting.load(Ordering::SeqCst) > 0 {
            turn.touch();
            continue;
        }
        let quiet = turn.activity.lock().expect("activity").elapsed();
        if quiet < after || turn.stalled.swap(true, Ordering::SeqCst) {
            continue;
        }
        let since = state.now_ms() - quiet.as_millis() as i64;
        let _ = state.append(
            &turn.task,
            &turn.starter,
            "turn.stalled",
            json!({ "since": since }),
            None,
        );
    }
}

/// Counts a wait (an Approval, the write lock) for as long as it lives, so the
/// Turn is not written down as stalled meanwhile.
struct Waiting(Option<Arc<RunningTurn>>);

impl Waiting {
    fn on(state: &State, task: &str) -> Self {
        let turn = state.turn_of(task);
        if let Some(turn) = &turn {
            turn.waiting.fetch_add(1, Ordering::SeqCst);
        }
        Self(turn)
    }
}

impl Drop for Waiting {
    fn drop(&mut self) {
        if let Some(turn) = &self.0 {
            turn.waiting.fetch_sub(1, Ordering::SeqCst);
            turn.touch();
        }
    }
}

/// Shows a Question Card and waits for the Turn's Member, as an Approval waits
/// (ADR 0082): the same time limit, and a Stop ends the wait. The answer, or that
/// nobody answered, is what the model reads back.
async fn ask_card(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    events: &[TaskEvent],
    tool: &str,
    input: &Value,
    cancel: &Cancel,
) -> Result<String, ToolError> {
    let checked = crate::cards::check(tool, input).map_err(ToolError::Failed)?;
    // The Member who sent this Turn's message, as `turn.started` wrote it.
    let member = events
        .iter()
        .rev()
        .find(|event| event.kind == "turn.started")
        .and_then(|event| event.body.get("member"))
        .and_then(Value::as_str)
        .unwrap_or(starter)
        .to_string();
    let _waiting = Waiting::on(state, task);
    let id = request_id(state).replacen("ap_", "cd_", 1);
    let timeout = state.approval_timeout();
    let expires_at = state.now_ms() + timeout.as_millis() as i64;
    let (answer, answered) = oneshot::channel();
    state.questions.lock().expect("questions").insert(
        id.clone(),
        Question {
            task: task.to_string(),
            starter: starter.to_string(),
            member: member.clone(),
            answer,
        },
    );
    let _ = state.append(
        task,
        starter,
        "card.shown",
        json!({
            "id": id,
            "card": tool,
            "version": crate::cards::CARD_VERSION,
            "value": checked.value,
            "fallback": checked.fallback,
            "member": member,
            "expiresAt": expires_at,
        }),
        None,
    );
    let settled = tokio::select! {
        biased;
        _ = cancel.cancelled() => None,
        answer = answered => answer.ok(),
        _ = tokio::time::sleep(timeout) => None,
    };
    let still_waiting = state
        .questions
        .lock()
        .expect("questions")
        .remove(&id)
        .is_some();
    if cancel.is_cancelled() {
        return Err(ToolError::Stopped);
    }
    if settled.is_none() && still_waiting {
        let _ = state.append(
            task,
            starter,
            "card.answered",
            json!({ "id": id, "expired": true }),
            None,
        );
    }
    Ok(crate::cards::result(settled.as_ref()))
}

async fn ask_approval(
    state: &Arc<State>,
    task: &str,
    starter: &str,
    command: &str,
    parts: Vec<String>,
    cancel: &Cancel,
) -> Answer {
    let _waiting = Waiting::on(state, task);
    let request = request_id(state);
    let timeout = state.approval_timeout();
    let expires_at = state.now_ms() + timeout.as_millis() as i64;
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

/// Refuses what a round nobody watches may not do, and writes it down so the
/// owner sees it and can add it to the Schedule's scope (ADR 0079).
fn skip(state: &State, task: &str, starter: &str, command: &str, parts: Vec<String>) -> ToolError {
    let _ = state.append(
        task,
        starter,
        "approval.skipped",
        json!({ "command": command, "parts": parts }),
        None,
    );
    ToolError::Failed(
        "nobody is watching this scheduled round, and this is outside what its Schedule may do, so it did not run. Do what you can without it, then tell the owner what you needed".into(),
    )
}

/// Whether the Turn under way was refused anything nobody could be asked about:
/// a command here, or a domain the supervisor's proxy wrote down (ADR 0079).
fn skipped_this_turn(state: &State, task: &str) -> Result<bool, AgentError> {
    let events = state.log().events(task, 0)?;
    let start = events
        .iter()
        .rposition(|event| event.kind == "turn.started")
        .unwrap_or(0);
    Ok(events[start..]
        .iter()
        .any(|event| event.kind == "approval.skipped"))
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
        _ if answer.message.as_deref() == Some("expired without an answer") => {
            ToolError::Failed(format!(
                "approval {} expired without an answer, so it did not run",
                answer.request
            ))
        }
        _ => ToolError::Failed(format!(
            "the owner denied approval {}, so it did not run",
            answer.request
        )),
    }
}

impl State {
    fn now_ms(&self) -> i64 {
        self.clock.read().expect("clock").now()
    }
}

/// A Turn's proxy token: random, never in the log, and of no use outside this
/// Agent's own sandbox (ADR 0080).
fn turn_token() -> String {
    let part = || {
        base36(
            std::collections::hash_map::RandomState::new()
                .build_hasher()
                .finish(),
        )
    };
    format!("tt{}{}", part(), part())
}

fn request_id(state: &State) -> String {
    let count = state.approvals.fetch_add(1, Ordering::SeqCst) + 1;
    format!(
        "ap_{}_{}_{}",
        base36(state.now_ms() as u64),
        base36(count),
        // A salt so two workers that start in the same millisecond never hand
        // out the same id. It is not a time: std's hasher keys are random.
        base36(
            std::collections::hash_map::RandomState::new()
                .build_hasher()
                .finish()
                % 36u64.pow(6)
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: i64, kind: &str) -> TaskEvent {
        TaskEvent {
            seq,
            kind: kind.into(),
            at: 0,
            body: json!({}),
        }
    }

    fn ended(seq: i64, reason: &str) -> TaskEvent {
        TaskEvent {
            body: json!({ "reason": reason }),
            ..event(seq, "turn.ended")
        }
    }

    #[test]
    fn a_task_is_named_once_after_its_first_turn_that_ends_done() {
        assert!(names_now(&[event(1, "member.message"), ended(2, "done")]));
        // A second done Turn: the first one already named it, or tried to.
        assert!(!names_now(&[ended(2, "done"), ended(5, "done")]));
        // The first Turn was stopped; the next done Turn names it.
        assert!(!names_now(&[ended(2, "stopped")]));
        assert!(names_now(&[ended(2, "stopped"), ended(5, "done")]));
        assert!(!names_now(&[ended(2, "error")]));
        // Only right after that Turn, not from a later event.
        assert!(!names_now(&[ended(2, "done"), event(3, "member.message")]));
    }

    #[test]
    fn a_request_is_counted_part_by_part_and_empty_parts_are_left_out() {
        let request = LlmRequest {
            task: "t1".into(),
            system: format!("{}{MEMORY_MARK}{}", "s".repeat(30), "m".repeat(9)),
            messages: vec![
                LlmMessage {
                    role: "user".into(),
                    content: vec![
                        json!({ "type": "text", "text": format!("{SUMMARY_MARK}\n{}", "x".repeat(20)) }),
                    ],
                },
                LlmMessage {
                    role: "user".into(),
                    content: vec![json!({ "type": "text", "text": "hello" })],
                },
                LlmMessage {
                    role: "assistant".into(),
                    content: vec![json!({ "type": "text", "text": "abcdef" })],
                },
                LlmMessage {
                    role: "user".into(),
                    content: vec![
                        json!({ "type": "tool_result", "tool_use_id": "tu1", "content": "123456789" }),
                    ],
                },
            ],
            tools: Vec::new(),
        };
        let parts = context_parts(&request);
        assert_eq!(parts["system"], 10);
        assert_eq!(parts["memory"], 3);
        assert_eq!(parts["you"], 2);
        assert_eq!(parts["agent"], 2);
        assert!(parts["summary"].as_u64().is_some_and(|tokens| tokens > 6));
        assert!(parts["results"].as_u64().is_some_and(|tokens| tokens >= 3));
        assert!(parts.get("tools").is_none());
    }

    #[test]
    fn a_name_is_one_line_without_quotes_and_within_the_cap() {
        assert_eq!(
            clean_title("  \"Fix the red CI build\"\nBecause..."),
            "Fix the red CI build"
        );
        assert_eq!(clean_title("“แก้ build บน CI ที่แดง”"), "แก้ build บน CI ที่แดง");
        assert_eq!(
            clean_title(&"ก".repeat(80)).chars().count(),
            TITLE_MAX_CHARS
        );
        assert_eq!(clean_title("  \n "), "");
    }

    #[test]
    fn a_flush_counts_only_until_the_compaction_it_precedes() {
        assert!(!flushed_since_compaction(&[event(1, "member.message")]));
        assert!(flushed_since_compaction(&[event(2, "memory.saved")]));
        // The last compaction closed that window; a later one flushes again.
        assert!(!flushed_since_compaction(&[
            event(2, "memory.saved"),
            event(3, "context.compacted")
        ]));
        assert!(flushed_since_compaction(&[
            event(3, "context.compacted"),
            event(4, "memory.saved")
        ]));
    }
}
