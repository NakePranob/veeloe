use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::watch;

/// The brake a Turn holds. A tool or an LLM call waits on `cancelled()` so a
/// Stop cuts what it started, instead of leaving it running behind a log that
/// already says the Turn ended (ADR 0017).
#[derive(Clone)]
pub struct Cancel {
    flag: Arc<watch::Sender<bool>>,
    watch: watch::Receiver<bool>,
}

impl Cancel {
    pub fn new() -> Self {
        let (flag, watch) = watch::channel(false);
        Self {
            flag: Arc::new(flag),
            watch,
        }
    }

    /// Stops everything waiting on this brake. Calling it again changes nothing.
    pub fn cancel(&self) {
        let _ = self.flag.send(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.watch.borrow()
    }

    /// Resolves once the brake is pulled; returns at once when it already is.
    pub async fn cancelled(&self) {
        let mut watch = self.watch.clone();
        loop {
            if *watch.borrow() {
                return;
            }
            if watch.changed().await.is_err() {
                return;
            }
        }
    }
}

impl Default for Cancel {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for Cancel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Cancel")
            .field("cancelled", &self.is_cancelled())
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ToolError {
    #[error("there is no tool named {0}")]
    Unknown(String),
    #[error("{0}")]
    Failed(String),
    #[error("the owner stopped this Turn before the command finished")]
    Stopped,
}

/// A capability the model can call. A runner may expose one or more tools; the
/// registry refuses two runners that claim the same name.
#[async_trait]
pub trait ToolRunner: Send + Sync {
    fn definitions(&self) -> Vec<ToolDefinition>;
    /// Runs one tool. An error becomes an error result the model reads. A
    /// pulled `cancel` kills whatever the call started.
    async fn run(&self, name: &str, input: &Value, cancel: &Cancel) -> Result<String, ToolError>;
}

#[derive(Default)]
pub struct ToolRegistry {
    runners: Vec<Arc<dyn ToolRunner>>,
    by_name: HashMap<String, Arc<dyn ToolRunner>>,
}

impl ToolRegistry {
    pub fn register(&mut self, runner: Arc<dyn ToolRunner>) -> Result<(), PluginError> {
        for definition in runner.definitions() {
            if self.by_name.contains_key(&definition.name) {
                return Err(PluginError::DuplicateTool(definition.name));
            }
            self.by_name
                .insert(definition.name.clone(), Arc::clone(&runner));
        }
        self.runners.push(runner);
        Ok(())
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.runners
            .iter()
            .flat_map(|runner| runner.definitions())
            .collect()
    }

    pub fn has(&self, name: &str) -> bool {
        self.by_name.contains_key(name)
    }

    pub async fn run(
        &self,
        name: &str,
        input: &Value,
        cancel: &Cancel,
    ) -> Result<String, ToolError> {
        let runner = self
            .by_name
            .get(name)
            .ok_or_else(|| ToolError::Unknown(name.to_string()))?;
        runner.run(name, input, cancel).await
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PluginError {
    #[error("duplicate tool: {0}")]
    DuplicateTool(String),
    #[error("{0}")]
    Failed(String),
}

pub trait Plugin: Send + Sync {
    fn name(&self) -> &'static str;
    fn setup(&self, ctx: &mut Context) -> Result<(), PluginError>;
}

#[derive(Default)]
pub struct Context {
    pub tools: ToolRegistry,
}

impl Context {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Mounts first-party plugins in order. A plugin owns its registrations; the
/// host only composes them. Third-party code does not run here.
pub struct PluginHost;

impl PluginHost {
    pub fn mount(plugins: &[Arc<dyn Plugin>]) -> Result<Context, PluginError> {
        let mut ctx = Context::new();
        for plugin in plugins {
            plugin.setup(&mut ctx)?;
        }
        Ok(ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Echo;

    #[async_trait]
    impl ToolRunner for Echo {
        fn definitions(&self) -> Vec<ToolDefinition> {
            vec![ToolDefinition {
                name: "echo".into(),
                description: "Return the text it was given.".into(),
                input_schema: json!({ "type": "object", "properties": { "text": { "type": "string" } } }),
            }]
        }

        async fn run(
            &self,
            name: &str,
            input: &Value,
            _cancel: &Cancel,
        ) -> Result<String, ToolError> {
            if name != "echo" {
                return Err(ToolError::Unknown(name.into()));
            }
            Ok(input
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string())
        }
    }

    struct EchoPlugin;

    impl Plugin for EchoPlugin {
        fn name(&self) -> &'static str {
            "echo"
        }

        fn setup(&self, ctx: &mut Context) -> Result<(), PluginError> {
            ctx.tools.register(Arc::new(Echo))
        }
    }

    #[tokio::test]
    async fn mounts_a_plugin_and_runs_its_tool() {
        let ctx = PluginHost::mount(&[Arc::new(EchoPlugin)]).expect("mount");
        assert_eq!(ctx.tools.definitions().len(), 1);
        assert_eq!(
            ctx.tools
                .run("echo", &json!({ "text": "hi" }), &Cancel::new())
                .await
                .unwrap(),
            "hi"
        );
        assert_eq!(
            ctx.tools
                .run("missing", &json!({}), &Cancel::new())
                .await
                .unwrap_err(),
            ToolError::Unknown("missing".into())
        );
    }

    #[test]
    fn refuses_two_runners_claiming_one_name() {
        let mut ctx = Context::new();
        ctx.tools.register(Arc::new(Echo)).expect("first");
        assert_eq!(
            ctx.tools.register(Arc::new(Echo)).unwrap_err(),
            PluginError::DuplicateTool("echo".into())
        );
    }

    #[tokio::test]
    async fn a_cancelled_brake_wakes_its_waiters_and_stays_pulled() {
        let cancel = Cancel::new();
        let waiter = cancel.clone();
        let waiting = tokio::spawn(async move { waiter.cancelled().await });
        cancel.cancel();
        waiting.await.expect("waiter");
        assert!(cancel.is_cancelled());
        // Already pulled: the wait returns at once.
        cancel.cancelled().await;
    }
}
