//! The Agents on this Machine and where each one lives, ported from
//! `packages/runtime-legacy/src/supervisor/agent-registry/registry.ts`.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("{0}")]
    File(String),
    #[error("agent id is not a plain folder name: {0}")]
    BadId(String),
}

impl From<JsonFileError> for AgentError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for AgentError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// One Agent (ADR 0020). The look is kept as sent, so it never changes with a
/// Controller's version (ADR 0006).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub character: Option<Value>,
    #[serde(default)]
    pub allowlist: Vec<String>,
    #[serde(rename = "approvalTimeoutS", default = "default_timeout")]
    pub approval_timeout_s: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<u64>,
}

fn default_timeout() -> u64 {
    3_600
}

/// The Agents on this Machine, in the supervisor's own file.
pub struct AgentRegistry {
    file: PathBuf,
}

impl AgentRegistry {
    pub fn open(home: &Path) -> Result<Self, AgentError> {
        Ok(Self {
            file: supervisor_dir(home)?.join("agents.json"),
        })
    }

    pub fn all(&self) -> Result<Vec<Agent>, AgentError> {
        let Some(value) = read_json_file(&self.file)? else {
            return Ok(Vec::new());
        };
        let agents = value
            .as_array()
            .map(|agents| {
                agents
                    .iter()
                    .filter_map(|agent| serde_json::from_value(agent.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(agents)
    }

    pub fn get(&self, id: &str) -> Result<Option<Agent>, AgentError> {
        Ok(self.all()?.into_iter().find(|agent| agent.id == id))
    }

    pub fn add(&self, agent: &Agent) -> Result<(), AgentError> {
        let mut agents = self.all()?;
        agents.push(agent.clone());
        self.save(&agents)
    }

    /// The Agent with this id, changed, in one write of the whole file.
    pub fn replace(&self, agent: &Agent) -> Result<(), AgentError> {
        let mut agents = self.all()?;
        for slot in agents.iter_mut() {
            if slot.id == agent.id {
                *slot = agent.clone();
            }
        }
        self.save(&agents)
    }

    pub fn remove(&self, id: &str) -> Result<(), AgentError> {
        let agents: Vec<Agent> = self.all()?.into_iter().filter(|agent| agent.id != id).collect();
        self.save(&agents)
    }

    fn save(&self, agents: &[Agent]) -> Result<(), AgentError> {
        write_json_file(
            &self.file,
            &serde_json::to_value(agents).unwrap_or(Value::Array(Vec::new())),
        )?;
        Ok(())
    }
}

/// `<home>/agents/<id>/` with its Workdir and its TMPDIR (ADR 0032). The Runtime
/// picks the place; the id must be a plain folder name.
pub fn agent_dir(home: &Path, id: &str) -> Result<PathBuf, AgentError> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id == "."
        || id == ".."
        || id.contains('\0')
    {
        return Err(AgentError::BadId(id.to_string()));
    }
    let dir = home.join("agents").join(id);
    for sub in ["workdir", "tmp"] {
        let path = dir.join(sub);
        fs::create_dir_all(&path).map_err(|error| AgentError::File(error.to_string()))?;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}
