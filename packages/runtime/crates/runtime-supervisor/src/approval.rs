//! Asking before a domain opens (issue #44, ADR 0010, 0029).
//!
//! The proxy sees a CONNECT for a host that is not in the Agent's Egress. Until
//! now it dropped the connection, which the owner could neither see nor answer.
//! Here it writes an `approval.requested` event for the Turn that is running,
//! sends it to the Member who may answer, and holds the connection until that
//! Member answers, the Turn ends, or the Agent's Approval timeout passes.
//!
//! An answer is not a fact until it is checked: it must name the same request,
//! the same Agent and the same Task, it must come from the Member of that Turn,
//! and that Member must have Approve at that Agent (ADR 0010). In v0.1 that is
//! the Owner whose key signed the envelope ([`Trust::approves`]). Anything else
//! is refused and the connection keeps waiting.
//!
//! `always` is the permanent yes: the domain goes into that Agent's Egress in
//! one write, so the next request does not ask again. `approve` opens this one
//! connection only and leaves the Egress as it was.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::oneshot;
use veeloe_runtime_core::{FromWorker, TaskEvent};

use crate::agents::AgentRegistry;
use crate::egress::Egress;
use crate::task_log::TaskLogs;
use crate::tasks::{Inbound, Outbox};
use crate::trust::Trust;

/// The Approval timeout an Agent gets when its row does not name one.
pub const DEFAULT_TIMEOUT_S: u64 = 3_600;

/// What the proxy knows about the Turn an Agent is running: who it acts for and
/// which Task it belongs to. Learned from the `turn.started`/`turn.ended` events
/// the supervisor already sees, never from the worker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    pub task: String,
    /// The Member whose message started this Turn (ADR 0010).
    pub member: String,
    /// `task:seq` of the `turn.started` event, for the log.
    pub id: String,
}

/// The running Turn per Agent. No Turn means no way out: the proxy refuses a
/// connection instead of opening one nobody is answerable for.
#[derive(Debug, Default)]
pub struct Turns {
    running: Mutex<HashMap<String, Turn>>,
}

impl Turns {
    /// Records a Turn boundary. A `turn.ended` only clears the Turn it belongs
    /// to, so a late end from a stopped worker cannot erase the next one.
    pub fn observe(&self, agent: &str, task: &str, event: &TaskEvent) {
        match event.kind.as_str() {
            "turn.started" => {
                let member = event
                    .body
                    .get("member")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                self.running.lock().expect("turns").insert(
                    agent.to_string(),
                    Turn {
                        task: task.to_string(),
                        member,
                        id: format!("{task}:{}", event.seq),
                    },
                );
            }
            "turn.ended" => {
                let mut running = self.running.lock().expect("turns");
                if running
                    .get(agent)
                    .is_some_and(|turn| turn.task == task)
                {
                    running.remove(agent);
                }
            }
            _ => {}
        }
    }

    pub fn current(&self, agent: &str) -> Option<Turn> {
        self.running.lock().expect("turns").get(agent).cloned()
    }

    pub fn forget(&self, agent: &str) {
        self.running.lock().expect("turns").remove(agent);
    }
}

/// What the proxy does with one connection once the wait ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decision {
    Allow,
    Deny,
}

struct Pending {
    agent: String,
    task: String,
    member: String,
    domain: String,
    answer: oneshot::Sender<Decision>,
}

/// The proxy's Approvals: the running Turn per Agent, the requests waiting for
/// an answer, and the Egress a permanent yes writes to.
pub struct Approvals {
    home: PathBuf,
    egress: Arc<Egress>,
    logs: Arc<TaskLogs>,
    turns: Turns,
    pending: Mutex<HashMap<String, Pending>>,
    next: AtomicU64,
    /// Where an event goes, exactly as a worker's event does. Set once the
    /// supervisor exists; absent means nobody hears the request and it expires.
    delivering: Mutex<Option<Arc<dyn Fn(&str, FromWorker) + Send + Sync>>>,
    /// Tests wait seconds instead of an hour. Production leaves it unset.
    #[cfg(test)]
    timeout: Mutex<Option<Duration>>,
}

impl Approvals {
    pub fn new(home: PathBuf, egress: Arc<Egress>, logs: Arc<TaskLogs>) -> Self {
        Self {
            home,
            egress,
            logs,
            turns: Turns::default(),
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(0),
            delivering: Mutex::new(None),
            #[cfg(test)]
            timeout: Mutex::new(None),
        }
    }

    /// Where the request and its answer go. The same path a worker's event
    /// takes, so the Controller already knows how to draw it.
    pub fn delivering(&self, deliver: Arc<dyn Fn(&str, FromWorker) + Send + Sync>) {
        *self.delivering.lock().expect("delivering") = Some(deliver);
    }

    /// Follows a worker event: the Turn it starts or ends, and the requests an
    /// ended Turn leaves behind.
    pub fn observe(&self, agent: &str, message: &FromWorker) {
        let FromWorker::Event { task, event, .. } = message else {
            return;
        };
        self.observe_event(agent, task, event);
    }

    /// The same boundary, seen at the moment the supervisor writes it. A log
    /// append lands before the worker's live event, so a command that reaches
    /// the proxy first still finds its Turn.
    pub fn observe_event(&self, agent: &str, task: &str, event: &TaskEvent) {
        self.turns.observe(agent, task, event);
        if event.kind == "turn.ended" {
            self.end_turn(agent, task);
        }
    }

    /// The Turn this Agent is running now, if any.
    pub fn current_turn(&self, agent: &str) -> Option<Turn> {
        self.turns.current(agent)
    }

    /// A worker ended without a `turn.ended`: nothing of that Agent may ask or
    /// wait any more (ADR 0033).
    pub fn forget_agent(&self, agent: &str) {
        self.turns.forget(agent);
        let mut pending = self.pending.lock().expect("pending");
        let requests: Vec<String> = pending
            .iter()
            .filter(|(_, request)| request.agent == agent)
            .map(|(request, _)| request.clone())
            .collect();
        for request in requests {
            if let Some(request) = pending.remove(&request) {
                let _ = request.answer.send(Decision::Deny);
            }
        }
    }

    /// Whether `request` is a domain approval this supervisor is holding. Used
    /// to answer it here instead of forwarding it to the worker.
    pub fn is_pending(&self, request: &str) -> bool {
        self.pending
            .lock()
            .expect("pending")
            .contains_key(request)
    }

    /// Holds one connection until this Agent's Member answers, or the wait ends.
    /// False closes the connection: no Turn, no Egress, no answer, or a timeout
    /// all end the same way, so nothing passes by staying quiet.
    pub async fn ask(&self, agent: &str, host: &str) -> bool {
        let Some(turn) = self.current_turn(agent) else {
            return false;
        };
        // An Agent this Machine does not know, or one whose row cannot be read,
        // has no timeout and no Member to ask: refuse rather than invent both.
        let Ok(registry) = AgentRegistry::open(&self.home) else {
            return false;
        };
        let Ok(Some(row)) = registry.get(agent) else {
            return false;
        };
        let timeout = self.timeout(row.approval_timeout_s);
        let request = self.request_id();
        let (answer, waiting) = oneshot::channel();
        self.pending.lock().expect("pending").insert(
            request.clone(),
            Pending {
                agent: agent.to_string(),
                task: turn.task.clone(),
                member: turn.member.clone(),
                domain: host.to_string(),
                answer,
            },
        );
        let expires_at = crate::usage::now_ms() + timeout.as_millis() as i64;
        let body = json!({
            "request": request,
            "kind": "domain",
            "domain": host,
            "agent": agent,
            "task": &turn.task,
            "expiresAt": expires_at,
        });
        let event = match self.logs.record(
            agent,
            &turn.task,
            &turn.member,
            "approval.requested",
            &body,
            None,
        ) {
            Ok(event) => event,
            Err(_) => {
                self.pending.lock().expect("pending").remove(&request);
                return false;
            }
        };
        self.emit(agent, &turn.member, &turn.task, event);

        let decision = tokio::select! {
            biased;
            answer = waiting => answer.unwrap_or(Decision::Deny),
            _ = tokio::time::sleep(timeout) => {
                // The answer and the timeout can land together: whichever takes
                // the request out of the map decides it, once.
                if self.pending.lock().expect("pending").remove(&request).is_some() {
                    self.answered(
                        agent,
                        &turn.task,
                        &turn.member,
                        &request,
                        None,
                        "deny",
                        Some("expired without an answer"),
                    );
                }
                Decision::Deny
            }
        };
        decision == Decision::Allow
    }

    /// One `approval.answer`. True when it was this supervisor's to answer,
    /// whether or not it was accepted: a refused answer keeps waiting.
    pub fn answer(
        &self,
        from: &Inbound,
        body: &Value,
        trust: Option<&Trust>,
        outbox: &dyn Outbox,
    ) -> bool {
        let Some(request) = body.get("request").and_then(Value::as_str) else {
            return false;
        };
        // A request the worker is holding is not ours: it goes on to the worker.
        let Some(pending) = self.pending.lock().expect("pending").get(request).map(|pending| {
            (
                pending.agent.clone(),
                pending.task.clone(),
                pending.member.clone(),
                pending.domain.clone(),
            )
        }) else {
            return false;
        };
        let (agent, task, member, domain) = pending;
        let decision = body.get("decision").and_then(Value::as_str).unwrap_or_default();
        if !matches!(decision, "approve" | "deny" | "always") {
            outbox.error(from, "approval.unknown");
            return true;
        }
        // The answer names the Agent and the Task it is for. A Controller that
        // says otherwise is answering something else, even with the right id.
        if body.get("agent").and_then(Value::as_str) != Some(agent.as_str())
            || from.task.as_deref() != Some(task.as_str())
        {
            outbox.error(from, "approval.unknown");
            return true;
        }
        let Some(trust) = trust else {
            outbox.error(from, "approval.forbidden");
            return true;
        };
        // v0.1: the Owner whose key signed, and the Member whose Turn asked.
        if from.member != member || !trust.approves(&from.member, from.key.as_deref()) {
            outbox.error(from, "approval.forbidden");
            return true;
        }
        if decision == "always" {
            // A permanent yes changes the Agent's Egress, which is Manage, not
            // Approve (ADR 0029). v0.1 has them on the same Member; the check
            // is here so a later Grant split does not open it by accident.
            if !trust.manages(&from.member, from.key.as_deref()) {
                outbox.error(from, "approval.forbidden");
                return true;
            }
            match self.egress.add_domain(&agent, &domain) {
                Ok(Some(_)) => {}
                // Not written is not a permanent yes: refuse and keep waiting
                // rather than open the domain for one connection only.
                _ => {
                    outbox.error(from, "approval.unavailable");
                    return true;
                }
            }
        }
        let Some(pending) = self.pending.lock().expect("pending").remove(request) else {
            return true;
        };
        self.answered(
            &agent,
            &task,
            &member,
            request,
            Some(&from.member),
            decision,
            None,
        );
        let _ = pending.answer.send(if decision == "deny" {
            Decision::Deny
        } else {
            Decision::Allow
        });
        true
    }

    /// The Turn ended, by Stop or by finishing: every request it still holds is
    /// denied, and its connection closes. No answer is written, exactly as a
    /// command Approval cut short by a Stop writes none (ADR 0017).
    fn end_turn(&self, agent: &str, task: &str) {
        let mut pending = self.pending.lock().expect("pending");
        let requests: Vec<String> = pending
            .iter()
            .filter(|(_, request)| request.agent == agent && request.task == task)
            .map(|(request, _)| request.clone())
            .collect();
        for request in requests {
            if let Some(request) = pending.remove(&request) {
                let _ = request.answer.send(Decision::Deny);
            }
        }
    }

    fn request_id(&self) -> String {
        let count = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        format!("apd_{}_{count}", crate::usage::now_ms())
    }

    fn timeout(&self, seconds: u64) -> Duration {
        #[cfg(test)]
        if let Some(timeout) = *self.timeout.lock().expect("timeout") {
            return timeout;
        }
        Duration::from_secs(seconds)
    }

    #[allow(clippy::too_many_arguments)]
    fn answered(
        &self,
        agent: &str,
        task: &str,
        member: &str,
        request: &str,
        by: Option<&str>,
        decision: &str,
        message: Option<&str>,
    ) {
        let mut body = json!({ "request": request, "decision": decision });
        if let Some(by) = by {
            body["member"] = json!(by);
        }
        if let Some(message) = message {
            body["message"] = json!(message);
        }
        if let Ok(event) = self
            .logs
            .record(agent, task, member, "approval.answered", &body, None)
        {
            self.emit(agent, member, task, event);
        }
    }

    fn emit(&self, agent: &str, starter: &str, task: &str, event: TaskEvent) {
        let Some(deliver) = self
            .delivering
            .lock()
            .expect("delivering")
            .as_ref()
            .map(Arc::clone)
        else {
            return;
        };
        deliver(
            agent,
            FromWorker::Event {
                task: task.to_string(),
                starter: starter.to_string(),
                event,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::Agent;
    use veeloe_runtime_core::{LogAnswer, LogQuery};

    fn agent(id: &str) -> Agent {
        Agent {
            id: id.into(),
            name: id.into(),
            provider: "main".into(),
            model: "model-a".into(),
            character: None,
            allowlist: Vec::new(),
            egress: Vec::new(),
            approval_timeout_s: 3_600,
            budget: None,
            deleted_at: None,
        }
    }

    fn trust() -> Trust {
        Trust {
            owners: vec![crate::trust::Owner {
                member: "m_1".into(),
                keys: vec!["k_1".into()],
            }],
            workspace: Some("w_1".into()),
            links: Vec::new(),
            revoked: Vec::new(),
        }
    }

    struct Seen {
        events: Mutex<Vec<(String, FromWorker)>>,
        errors: Mutex<Vec<(String, String)>>,
    }

    impl Seen {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                errors: Mutex::new(Vec::new()),
            }
        }

    }

    impl Outbox for Seen {
        fn to_member(&self, member: &str, type_: &str, body: Value, task: Option<&str>) {
            self.events.lock().expect("events").push((
                member.to_string(),
                FromWorker::Event {
                    task: task.unwrap_or_default().to_string(),
                    starter: member.to_string(),
                    event: TaskEvent {
                        seq: 0,
                        kind: type_.to_string(),
                        at: 0,
                        body,
                    },
                },
            ));
        }

        fn error(&self, to: &Inbound, code: &str) {
            self.errors
                .lock()
                .expect("errors")
                .push((to.member.clone(), code.to_string()));
        }
    }

    fn inbound(member: &str, task: Option<&str>) -> Inbound {
        Inbound {
            member: member.into(),
            key: Some("k_1".into()),
            reference: "sig".into(),
            task: task.map(str::to_string),
        }
    }

    struct Fixture {
        _home: tempfile::TempDir,
        egress: Arc<Egress>,
        logs: Arc<TaskLogs>,
        approvals: Arc<Approvals>,
        seen: Arc<Seen>,
    }

    fn fixture() -> Fixture {
        let home = tempfile::tempdir().expect("home");
        let registry = AgentRegistry::open(home.path()).expect("registry");
        registry.add(&agent("a1")).expect("a1");
        registry.add(&agent("a2")).expect("a2");
        // The supervisor creates these before a worker starts (ADR 0069); a
        // slice test writes an approval without one.
        for id in ["a1", "a2"] {
            std::fs::create_dir_all(crate::task_log::dir(home.path(), id)).expect("task log");
        }
        let egress = Arc::new(Egress::open(home.path()).expect("egress"));
        let logs = Arc::new(TaskLogs::new(home.path()));
        let approvals = Arc::new(Approvals::new(
            home.path().to_path_buf(),
            Arc::clone(&egress),
            Arc::clone(&logs),
        ));
        let seen = Arc::new(Seen::new());
        let sink = Arc::clone(&seen);
        approvals.delivering(Arc::new(move |agent: &str, message: FromWorker| {
            sink.events
                .lock()
                .expect("events")
                .push((agent.to_string(), message));
        }));
        Fixture {
            _home: home,
            egress,
            logs,
            approvals,
            seen,
        }
    }

    fn start_turn(approvals: &Approvals, agent: &str, task: &str, member: &str) {
        approvals.observe(
            agent,
            &FromWorker::Event {
                task: task.into(),
                starter: member.into(),
                event: TaskEvent {
                    seq: 1,
                    kind: "turn.started".into(),
                    at: 0,
                    body: json!({ "member": member }),
                },
            },
        );
    }

    fn end_turn(approvals: &Approvals, agent: &str, task: &str, member: &str) {
        approvals.observe(
            agent,
            &FromWorker::Event {
                task: task.into(),
                starter: member.into(),
                event: TaskEvent {
                    seq: 2,
                    kind: "turn.ended".into(),
                    at: 0,
                    body: json!({ "reason": "done" }),
                },
            },
        );
    }

    fn answered_events(logs: &TaskLogs, agent: &str, task: &str) -> Vec<Value> {
        let LogAnswer::Events { events } = logs
            .answer(agent, &LogQuery::Events {
                task: task.into(),
                after: 0,
            })
            .expect("events")
        else {
            panic!("an events answer");
        };
        events
            .into_iter()
            .filter(|event| event.kind == "approval.answered")
            .map(|event| event.body)
            .collect()
    }

    async fn requested(approvals: &Approvals, agent: &str, host: &str) -> bool {
        approvals.ask(agent, host).await
    }

    #[tokio::test]
    async fn a_domain_outside_the_egress_asks_the_turns_member_and_opens_on_a_yes() {
        let fixture = fixture();
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        let approvals = Arc::clone(&fixture.approvals);
        let asking = tokio::spawn(async move { approvals.ask("a1", "example.com").await });
        // The request is written into the Turn's log and sent to its Member.
        let mut request = String::new();
        for _ in 0..100 {
            let found = fixture.seen.events.lock().expect("events").iter().find_map(
                |(agent, message)| match message {
                    FromWorker::Event { event, .. } if event.kind == "approval.requested" => {
                        Some((agent.clone(), event.body.clone()))
                    }
                    _ => None,
                },
            );
            if let Some((agent, body)) = found {
                assert_eq!(agent, "a1");
                assert_eq!(body["kind"], "domain");
                assert_eq!(body["domain"], "example.com");
                assert_eq!(body["agent"], "a1");
                assert_eq!(body["task"], "t1");
                request = body["request"].as_str().expect("request").to_string();
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(!request.is_empty(), "no approval was asked");
        assert!(fixture.approvals.is_pending(&request));

        let outbox = Seen::new();
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": request, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(asking.await.expect("join"), "an approve did not open the connection");
        // One connection only: the Egress is exactly as it was.
        assert!(fixture.egress.current("a1").is_empty());
        let answered = answered_events(&fixture.logs, "a1", "t1");
        assert_eq!(answered[0]["decision"], "approve");
        assert_eq!(answered[0]["member"], "m_1");
    }

    #[tokio::test]
    async fn a_permanent_yes_adds_the_domain_to_that_agents_egress_alone() {
        let fixture = fixture();
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        let approvals = Arc::clone(&fixture.approvals);
        let asking = tokio::spawn(async move { approvals.ask("a1", "example.com").await });
        let request = wait_for_request(&fixture).await;
        let outbox = Seen::new();
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": request, "decision": "always" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(asking.await.expect("join"));
        assert_eq!(fixture.egress.current("a1"), vec!["example.com".to_string()]);
        assert!(fixture.egress.current("a2").is_empty());
        let reopened = Egress::open(
            fixture
                ._home
                .path(),
        )
        .expect("reopen");
        assert_eq!(reopened.current("a1"), vec!["example.com".to_string()]);
        assert_eq!(
            answered_events(&fixture.logs, "a1", "t1")[0]["decision"],
            "always"
        );
    }

    async fn wait_for_request(fixture: &Fixture) -> String {
        for _ in 0..100 {
            let found = fixture
                .seen
                .events
                .lock()
                .expect("events")
                .iter()
                .find_map(|(_, message)| match message {
                    FromWorker::Event { event, .. } if event.kind == "approval.requested" => {
                        event.body["request"].as_str().map(str::to_string)
                    }
                    _ => None,
                });
            if let Some(request) = found {
                return request;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("no request");
    }

    #[tokio::test]
    async fn a_no_closes_the_connection_and_a_timeout_closes_it_too() {
        let fixture = fixture();
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        let approvals = Arc::clone(&fixture.approvals);
        let asking = tokio::spawn(async move { approvals.ask("a1", "example.com").await });
        let request = wait_for_request(&fixture).await;
        let outbox = Seen::new();
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": request, "decision": "deny" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(!asking.await.expect("join"));
        assert!(fixture.egress.current("a1").is_empty());

        // The timeout is the Agent's, but a test cannot wait an hour: it is
        // shortened here and the wait ends as a denial with no name on it.
        *fixture.approvals.timeout.lock().expect("timeout") = Some(Duration::from_millis(20));
        start_turn(&fixture.approvals, "a2", "t2", "m_1");
        assert!(!requested(&fixture.approvals, "a2", "example.com").await);
        let answered = answered_events(&fixture.logs, "a2", "t2");
        assert_eq!(answered[0]["decision"], "deny");
        assert!(answered[0].get("member").is_none());
    }

    #[tokio::test]
    async fn a_member_without_approve_or_the_wrong_member_is_refused_and_the_wait_goes_on() {
        let fixture = fixture();
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        let approvals = Arc::clone(&fixture.approvals);
        let asking = tokio::spawn(async move { approvals.ask("a1", "example.com").await });
        let request = wait_for_request(&fixture).await;
        let outbox = Seen::new();
        // m_2 is not an Owner here, so has no Approve at this Agent.
        assert!(fixture.approvals.answer(
            &inbound("m_2", Some("t1")),
            &json!({ "agent": "a1", "request": request, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        // The wrong Task is the wrong approval, even with the right id.
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t9")),
            &json!({ "agent": "a1", "request": request, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(fixture.approvals.is_pending(&request));
        assert_eq!(
            outbox.errors.lock().expect("errors").clone(),
            vec![
                ("m_2".to_string(), "approval.forbidden".to_string()),
                ("m_1".to_string(), "approval.unknown".to_string())
            ]
        );
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": request, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(asking.await.expect("join"));
    }

    #[tokio::test]
    async fn two_agents_approvals_do_not_cross() {
        let fixture = fixture();
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        start_turn(&fixture.approvals, "a2", "t2", "m_1");
        let one = Arc::clone(&fixture.approvals);
        let two = Arc::clone(&fixture.approvals);
        let first = tokio::spawn(async move { one.ask("a1", "one.example.com").await });
        let second = tokio::spawn(async move { two.ask("a2", "two.example.com").await });
        // Wait for both requests, then answer only a1's.
        let mut requests = Vec::new();
        for _ in 0..100 {
            requests = fixture
                .seen
                .events
                .lock()
                .expect("events")
                .iter()
                .filter_map(|(_, message)| match message {
                    FromWorker::Event { event, .. } if event.kind == "approval.requested" => {
                        Some(event.body.clone())
                    }
                    _ => None,
                })
                .collect();
            if requests.len() == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let one = requests
            .iter()
            .find(|body| body["agent"] == "a1")
            .expect("a1's request")["request"]
            .as_str()
            .expect("request")
            .to_string();
        let outbox = Seen::new();
        // a2's id, named as a1's Agent, is not a1's request.
        let two_id = requests
            .iter()
            .find(|body| body["agent"] == "a2")
            .expect("a2's request")["request"]
            .as_str()
            .expect("request")
            .to_string();
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": two_id, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        assert_eq!(
            outbox.errors.lock().expect("errors")[0].1,
            "approval.unknown"
        );
        assert!(fixture.approvals.is_pending(&two_id));
        assert!(fixture.approvals.answer(
            &inbound("m_1", Some("t1")),
            &json!({ "agent": "a1", "request": one, "decision": "approve" }),
            Some(&trust()),
            &outbox,
        ));
        assert!(first.await.expect("join"));
        assert!(fixture.approvals.is_pending(&two_id));
        assert!(!second.is_finished());
        fixture.approvals.answer(
            &inbound("m_1", Some("t2")),
            &json!({ "agent": "a2", "request": two_id, "decision": "deny" }),
            Some(&trust()),
            &outbox,
        );
        assert!(!second.await.expect("join"));
    }

    #[tokio::test]
    async fn no_running_turn_and_a_finished_turn_both_refuse() {
        let fixture = fixture();
        assert!(!requested(&fixture.approvals, "a1", "example.com").await);
        start_turn(&fixture.approvals, "a1", "t1", "m_1");
        let approvals = Arc::clone(&fixture.approvals);
        let asking = tokio::spawn(async move { approvals.ask("a1", "example.com").await });
        let _request = wait_for_request(&fixture).await;
        end_turn(&fixture.approvals, "a1", "t1", "m_1");
        assert!(!asking.await.expect("join"));
        assert!(!requested(&fixture.approvals, "a1", "example.com").await);
    }
}
