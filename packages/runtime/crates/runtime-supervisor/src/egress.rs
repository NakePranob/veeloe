//! The Machine's one Egress, ported from
//! `packages/runtime-legacy/src/supervisor/egress/egress.ts`.
//!
//! No file is an empty list, and an empty list lets no Agent out (ADR 0008,
//! 0029). A file that does not hold a list of domains opens nothing.

use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};
use veeloe_protocol::messages::message_is_valid;

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

const FILE: &str = "egress.json";

#[derive(Debug, thiserror::Error)]
pub enum EgressError {
    #[error("{0}")]
    File(String),
}

impl From<JsonFileError> for EgressError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for EgressError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// Whether this is a list of domains the Protocol accepts. The same check every
/// `egress.set` goes through.
pub fn is_valid_egress(domains: &[String]) -> bool {
    message_is_valid("egress.set", &json!({ "egress": domains })) == Some(true)
}

pub fn load_egress(home: &Path) -> Result<Vec<String>, EgressError> {
    let file = supervisor_dir(home)?.join(FILE);
    let Some(value) = read_json_file(&file)? else {
        return Ok(Vec::new());
    };
    let domains: Vec<String> = value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if !is_valid_egress(&domains) {
        return Ok(Vec::new());
    }
    Ok(dedupe(domains))
}

/// The whole new list, already checked against the Protocol's schema and signed
/// by a key in trust. Saved in one step, then given to the sandbox for every
/// worker's next connection.
pub struct Egress {
    home: std::path::PathBuf,
    current: Mutex<Vec<String>>,
}

impl Egress {
    pub fn open(home: &Path) -> Result<Self, EgressError> {
        Ok(Self {
            home: home.to_path_buf(),
            current: Mutex::new(load_egress(home)?),
        })
    }

    pub fn current(&self) -> Vec<String> {
        self.current.lock().expect("egress").clone()
    }

    /// The list as it will be kept, or None when the Protocol would refuse it.
    pub fn set(&self, domains: Vec<String>) -> Result<Option<Vec<String>>, EgressError> {
        if !is_valid_egress(&domains) {
            return Ok(None);
        }
        let next = dedupe(domains);
        write_json_file(
            &supervisor_dir(&self.home)?.join(FILE),
            &Value::Array(next.iter().cloned().map(Value::String).collect()),
        )?;
        *self.current.lock().expect("egress") = next.clone();
        Ok(Some(next))
    }
}

fn dedupe(domains: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for domain in domains {
        if !out.contains(&domain) {
            out.push(domain);
        }
    }
    out
}
