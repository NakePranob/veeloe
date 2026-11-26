use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{Map, Value};

use crate::base64url::to_base64url;
use crate::envelope::Envelope;

pub struct Outgoing {
    pub type_: String,
    pub to: Option<String>,
    pub recipients: Option<Vec<String>>,
    pub task: Option<String>,
    pub member: Option<String>,
    pub body: Value,
}

/// Signs envelopes as one sender. `seq` is the sender's counter; the caller
/// owns where it lives, because it must keep going up across restarts.
pub struct Signer {
    key: SigningKey,
    from: String,
}

impl Signer {
    pub fn new(secret_key: &[u8; 32]) -> Self {
        let key = SigningKey::from_bytes(secret_key);
        let from = to_base64url(key.verifying_key().as_bytes());
        Self { key, from }
    }

    pub fn from_base64url(secret_key: &str) -> Result<Self, crate::base64url::Base64UrlError> {
        let bytes = crate::base64url::from_base64url(secret_key)?;
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| crate::base64url::Base64UrlError)?;
        Ok(Self::new(&key))
    }

    pub fn sign(&self, out: Outgoing, seq: u64) -> Envelope {
        let mut map = Map::new();
        map.insert("type".to_string(), Value::String(out.type_.clone()));
        if let Some(to) = &out.to {
            map.insert("to".to_string(), Value::String(to.clone()));
        }
        if let Some(recipients) = &out.recipients {
            map.insert(
                "recipients".to_string(),
                Value::Array(recipients.iter().cloned().map(Value::String).collect()),
            );
        }
        if let Some(task) = &out.task {
            map.insert("task".to_string(), Value::String(task.clone()));
        }
        if let Some(member) = &out.member {
            map.insert("member".to_string(), Value::String(member.clone()));
        }
        map.insert("seq".to_string(), Value::Number(seq.into()));
        map.insert("body".to_string(), out.body.clone());

        let signed = serde_json::to_string(&Value::Object(map)).expect("serialize signed part");
        let signature = self.key.sign(signed.as_bytes());
        Envelope {
            v: 1,
            type_: out.type_,
            from: self.from.clone(),
            signed,
            sig: to_base64url(&signature.to_bytes()),
            to: out.to,
            recipients: out.recipients,
            task: out.task,
            member: out.member,
        }
    }
}
