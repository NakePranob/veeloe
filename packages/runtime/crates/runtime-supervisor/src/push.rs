//! Expo Push delivery for the two events a Member waits on (ADR 0044).
//!
//! The payload is generic by design: Task text, file names and Agent names
//! never leave the Machine through Apple, Google or Expo (ADR 0005).

use std::sync::Arc;

use serde_json::{json, Value};

use crate::llm::HttpClient;
use crate::push_tokens::PushToken;

const EXPO_PUSH: &str = "https://exp.host/--/api/v2/push/send";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushKind {
    Approval,
    TurnEnded,
}

impl PushKind {
    fn text(self, language: &str) -> (&'static str, &'static str) {
        match (self, language) {
            (Self::Approval, "th") => ("Veeloe", "มี Approval รออยู่"),
            (Self::Approval, _) => ("Veeloe", "An Approval is waiting"),
            (Self::TurnEnded, "th") => ("Veeloe", "งานเสร็จแล้ว"),
            (Self::TurnEnded, _) => ("Veeloe", "A Turn has finished"),
        }
    }

    fn data(self, agent: &str, task: &str, approval: Option<&str>) -> Value {
        let kind = match self {
            Self::Approval => "approval",
            Self::TurnEnded => "turn",
        };
        let mut data = json!({ "kind": kind, "agent": agent, "task": task });
        if let Some(approval) = approval {
            data["approval"] = json!(approval);
        }
        data
    }
}

/// What Expo said about one token in a send: keep it or drop it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    pub token: String,
    pub drop: bool,
}

/// Sends Generic Push through the same HTTPS client the Provider proxy uses.
pub struct ExpoPush {
    http: Arc<dyn HttpClient>,
}

impl ExpoPush {
    pub fn new(http: Arc<dyn HttpClient>) -> Self {
        Self { http }
    }

    /// Send one event to every token, and say which tokens Expo no longer knows.
    pub async fn send(
        &self,
        tokens: &[PushToken],
        kind: PushKind,
        agent: &str,
        task: &str,
        approval: Option<&str>,
    ) -> Result<Vec<Ticket>, String> {
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        let messages: Vec<Value> = tokens
            .iter()
            .map(|held| {
                let (title, body) = kind.text(&held.language);
                json!({
                    "to": held.token,
                    "title": title,
                    "body": body,
                    "data": kind.data(agent, task, approval),
                    "sound": "default",
                })
            })
            .collect();
        let answer = self
            .http
            .post(
                EXPO_PUSH,
                vec![(
                    "content-type".to_string(),
                    "application/json".to_string(),
                )],
                json!(messages).to_string(),
            )
            .await?;
        if answer.status != 200 {
            return Err(format!("expo.status.{}", answer.status));
        }
        let body: Value = serde_json::from_str(&answer.body).map_err(|_| "expo.invalid".to_string())?;
        let Some(entries) = body.get("data").and_then(Value::as_array) else {
            return Ok(Vec::new());
        };
        Ok(tokens
            .iter()
            .zip(entries.iter())
            .map(|(held, entry)| {
                let error = entry
                    .get("details")
                    .and_then(|details| details.get("error"))
                    .and_then(Value::as_str);
                Ticket {
                    token: held.token.clone(),
                    drop: error == Some("DeviceNotRegistered"),
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::HttpAnswer;
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct Fake {
        answer: HttpAnswer,
        seen: Mutex<Vec<(String, Vec<(String, String)>, String)>>,
    }

    #[async_trait]
    impl HttpClient for Fake {
        async fn get(&self, _url: &str, _headers: Vec<(String, String)>) -> Result<HttpAnswer, String> {
            Err("no".into())
        }

        async fn post(
            &self,
            url: &str,
            headers: Vec<(String, String)>,
            body: String,
        ) -> Result<HttpAnswer, String> {
            self.seen
                .lock()
                .expect("seen")
                .push((url.to_string(), headers, body));
            Ok(HttpAnswer {
                status: self.answer.status,
                headers: Vec::new(),
                body: self.answer.body.clone(),
            })
        }
    }

    fn token(language: &str) -> PushToken {
        PushToken {
            member: "m_1".into(),
            device: "key-1".into(),
            token: "ExponentPushToken[a]".into(),
            language: language.into(),
            updated: 1,
        }
    }

    #[tokio::test]
    async fn a_thai_approval_is_generic_and_names_no_task_text() {
        let fake = Fake {
            answer: HttpAnswer {
                status: 200,
                headers: Vec::new(),
                body: json!({ "data": [{ "status": "ok", "id": "1" }] }).to_string(),
            },
            seen: Mutex::new(Vec::new()),
        };
        let http = Arc::new(fake);
        let push = ExpoPush::new(http.clone());
        let tickets = push
            .send(&[token("th")], PushKind::Approval, "a1", "t1", Some("ap_1"))
            .await
            .expect("send");
        assert_eq!(tickets.len(), 1);
        assert!(!tickets[0].drop);
        let seen = http.seen.lock().expect("seen");
        let sent: Value = serde_json::from_str(&seen[0].2).expect("json");
        assert_eq!(sent[0]["body"], "มี Approval รออยู่");
        assert_eq!(sent[0]["data"]["kind"], "approval");
        assert_eq!(sent[0]["data"]["approval"], "ap_1");
        assert!(sent[0].get("content").is_none());
    }

    #[tokio::test]
    async fn a_dead_device_is_asked_to_be_dropped() {
        let fake = Fake {
            answer: HttpAnswer {
                status: 200,
                headers: Vec::new(),
                body: json!({ "data": [{ "status": "error", "details": { "error": "DeviceNotRegistered" } }] }).to_string(),
            },
            seen: Mutex::new(Vec::new()),
        };
        let push = ExpoPush::new(Arc::new(fake));
        let tickets = push
            .send(&[token("en")], PushKind::TurnEnded, "a1", "t1", None)
            .await
            .expect("send");
        assert!(tickets[0].drop);
    }
}
