//! The Provider and model each Task started on, ported from
//! `packages/runtime-legacy/src/supervisor/proxy/task-routes.ts`.
//!
//! A change to the Agent reaches only its next Tasks, and a restart does not
//! move a Task to a new model (ADR 0042). A Task whose pinned Provider is gone
//! moves to the Agent's current one, since the old one cannot answer anyway.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agents::Agent;
use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::providers::Provider;
use crate::trust::{supervisor_dir, TrustError};

const FILE: &str = "task-routes.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Pin {
    provider: String,
    model: String,
}

type Pins = HashMap<String, HashMap<String, Pin>>;

#[derive(Debug, thiserror::Error)]
pub enum TaskRoutesError {
    #[error("{0}")]
    File(String),
}

impl From<JsonFileError> for TaskRoutesError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for TaskRoutesError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// One line per Task, kept until the Task is gone.
pub struct TaskRoutes {
    file: PathBuf,
    pins: Mutex<Pins>,
}

impl TaskRoutes {
    pub fn open(home: &Path) -> Result<Self, TaskRoutesError> {
        let file = supervisor_dir(home)?.join(FILE);
        let value = read_json_file(&file)?;
        let mut pins: Pins = HashMap::new();
        if let Some(value) = value {
            if let Some(agents) = value.as_object() {
                for (agent, tasks) in agents {
                    let Some(tasks) = tasks.as_object() else {
                        continue;
                    };
                    let mut by_task = HashMap::new();
                    for (task, pin) in tasks {
                        if let Ok(pin) = serde_json::from_value::<Pin>(pin.clone()) {
                            by_task.insert(task.clone(), pin);
                        }
                    }
                    pins.insert(agent.clone(), by_task);
                }
            }
        }
        Ok(Self {
            file,
            pins: Mutex::new(pins),
        })
    }

    /// The Provider and model this Task is pinned to, or the Agent's current
    /// ones when it has no pin yet. `None` when the Agent's Provider is gone.
    pub fn route(
        &self,
        agent: &Agent,
        task: Option<&str>,
        providers: &[Provider],
    ) -> Option<(Provider, String)> {
        let mut pins = self.pins.lock().expect("task routes");
        if let Some(task) = task {
            if let Some(pin) = pins.get(&agent.id).and_then(|tasks| tasks.get(task)) {
                if let Some(provider) = providers.iter().find(|p| p.name == pin.provider) {
                    return Some((provider.clone(), pin.model.clone()));
                }
            }
        }
        let provider = providers.iter().find(|p| p.name == agent.provider)?;
        if let Some(task) = task {
            let next = Pin {
                provider: agent.provider.clone(),
                model: agent.model.clone(),
            };
            pins.entry(agent.id.clone())
                .or_default()
                .insert(task.to_string(), next);
            let value = Self::to_value(&pins);
            // A pin that cannot be written is reported, not turned into a
            // refusal: the Provider already has the request.
            let _ = write_json_file(&self.file, &value);
        }
        Some((provider.clone(), agent.model.clone()))
    }

    /// Drops the lines of Agents this Machine does not have, so nothing outlives
    /// its Agent.
    pub fn prune(&self, agent_ids: &[String]) -> Result<(), TaskRoutesError> {
        let mut pins = self.pins.lock().expect("task routes");
        let before = pins.len();
        pins.retain(|agent, _| agent_ids.contains(agent));
        if pins.len() != before {
            let value = Self::to_value(&pins);
            write_json_file(&self.file, &value)?;
        }
        Ok(())
    }

    /// Drop every Task line of one Agent. The Task history itself is not here.
    pub fn forget(&self, agent: &str) -> Result<(), TaskRoutesError> {
        let mut pins = self.pins.lock().expect("task routes");
        if pins.remove(agent).is_some() {
            write_json_file(&self.file, &Self::to_value(&pins))?;
        }
        Ok(())
    }

    fn to_value(pins: &Pins) -> Value {
        let mut agents = serde_json::Map::new();
        for (agent, tasks) in pins {
            let mut by_task = serde_json::Map::new();
            for (task, pin) in tasks {
                by_task.insert(task.clone(), json!(pin));
            }
            agents.insert(agent.clone(), Value::Object(by_task));
        }
        Value::Object(agents)
    }
}
