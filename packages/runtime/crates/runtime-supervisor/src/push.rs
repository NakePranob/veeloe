//! Expo Push delivery for the two events a Member waits on (ADR 0044).
//!
//! The payload is generic by design: Task text, file names and Agent names
//! never leave the Machine through Apple, Google or Expo (ADR 0005).

use std::sync::Arc;

use serde_json::{json, Value};

use crate::llm::HttpClient;
use crate::push_tokens::PushToken;
use crate::trust::Trust;

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

/// Who gets this push (ADR 0044): an Approval goes to whoever may answer it, a
/// Turn's end only to the Member who started that Turn. A token whose key is no
/// longer trusted for its Member gets nothing, even before revocation drops it.
pub fn recipients(
    trust: &Trust,
    tokens: &[PushToken],
    kind: PushKind,
    starter: &str,
) -> Vec<PushToken> {
    tokens
        .iter()
        .filter(|held| match kind {
            PushKind::Approval => trust.approves(&held.member, Some(&held.device)),
            PushKind::TurnEnded => {
                held.member == starter && trust.manages(&held.member, Some(&held.device))
            }
        })
        .cloned()
        .collect()
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
                vec![("content-type".to_string(), "application/json".to_string())],
                json!(messages).to_string(),
            )
            .await?;
        if answer.status != 200 {
            return Err(format!("expo.status.{}", answer.status));
        }
        let body: Value =
            serde_json::from_str(&answer.body).map_err(|_| "expo.invalid".to_string())?;
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
        async fn get(
            &self,
            _url: &str,
            _headers: Vec<(String, String)>,
        ) -> Result<HttpAnswer, String> {
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

    fn held(member: &str, device: &str) -> PushToken {
        PushToken {
            member: member.into(),
            device: device.into(),
            token: format!("ExponentPushToken[{device}]"),
            language: "en".into(),
            updated: 1,
        }
    }

    fn two_members() -> Trust {
        use crate::trust::Owner;
        Trust {
            owners: vec![
                Owner {
                    member: "m_1".into(),
                    keys: vec!["k1".into()],
                },
                Owner {
                    member: "m_2".into(),
                    keys: vec!["k2".into()],
                },
            ],
            ..Trust::default()
        }
    }

    fn devices(tokens: Vec<PushToken>) -> Vec<String> {
        tokens.into_iter().map(|held| held.device).collect()
    }

    #[test]
    fn an_approval_goes_to_every_member_who_may_answer_it() {
        let tokens = [held("m_1", "k1"), held("m_2", "k2")];
        let got = recipients(&two_members(), &tokens, PushKind::Approval, "m_1");
        assert_eq!(devices(got), vec!["k1", "k2"]);
    }

    #[test]
    fn a_turn_end_goes_only_to_the_member_who_started_it() {
        let tokens = [held("m_1", "k1"), held("m_2", "k2")];
        let got = recipients(&two_members(), &tokens, PushKind::TurnEnded, "m_2");
        assert_eq!(devices(got), vec!["k2"]);
        assert!(recipients(&two_members(), &tokens, PushKind::TurnEnded, "").is_empty());
    }

    #[test]
    fn a_key_no_longer_trusted_gets_no_push() {
        // k3 was m_1's, then revoked; its token has not been dropped yet.
        let tokens = [held("m_1", "k3"), held("m_2", "k1")];
        assert!(recipients(&two_members(), &tokens, PushKind::Approval, "m_1").is_empty());
        assert!(recipients(&two_members(), &tokens, PushKind::TurnEnded, "m_1").is_empty());
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
