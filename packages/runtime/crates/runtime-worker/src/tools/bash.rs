//! The `bash` tool (`sandboxed-commands`), ported from
//! `packages/runtime-legacy/src/worker/adapters/bash.ts`.
//!
//! It runs inside the worker's sandbox, so everything a command starts is under
//! the same rules (ADR 0008). Each command is its own process group in the
//! Workdir, with no stdin and with no variable the worker uses to reach the
//! supervisor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRunner};
use veeloe_runtime_core::sandbox::Sandbox;

pub const DEFAULT_TIMEOUT_S: u64 = 120;
pub const MAX_TIMEOUT_S: u64 = 600;
/// What the model gets of one command's output at most: the end of it, where the
/// error usually is.
pub const OUTPUT_LIMIT: usize = 30_000;

const DESCRIPTION: &str = "Runs a bash command on the owner's machine, in your working folder, and returns what it printed (stdout and stderr together) and its exit code.
Every command starts fresh in the working folder: cd, exported variables and shell functions do not carry over to the next command, so chain steps with && in one command.
There is no input: a command that waits for input gets none. A command that runs longer than its timeout is stopped with everything it started.
You can write only inside your own folder, and reach only the domains the owner allowed.";

/// The end of a command's output, and how much of the start was dropped.
#[derive(Default)]
struct Tail {
    text: String,
    dropped: usize,
}

impl Tail {
    fn add(&mut self, chunk: &[u8]) {
        self.text.push_str(&String::from_utf8_lossy(chunk));
        if self.text.chars().count() > OUTPUT_LIMIT * 2 {
            self.trim();
        }
    }

    fn trim(&mut self) -> String {
        let count = self.text.chars().count();
        if count <= OUTPUT_LIMIT {
            return self.text.clone();
        }
        self.dropped += count - OUTPUT_LIMIT;
        self.text = self.text.chars().skip(count - OUTPUT_LIMIT).collect();
        self.text.clone()
    }
}

pub struct BashTool {
    workdir: PathBuf,
    env: HashMap<String, String>,
    second_ms: u64,
    /// What a command is wrapped in. In a worker this adds nothing, because the
    /// worker is already inside the Agent's sandbox and its commands inherit it
    /// (ADR 0069); a test may still wrap each command itself.
    sandbox: Sandbox,
}

impl BashTool {
    /// `second_ms` is how long one "second" of the timeout really is: 1000 in
    /// production, and 20 in tests so the 120 s default does not take 120 s.
    pub fn new(
        workdir: impl AsRef<Path>,
        env: HashMap<String, String>,
        second_ms: u64,
        sandbox: Sandbox,
    ) -> Self {
        let env = env
            .into_iter()
            .filter(|(name, _)| !name.starts_with("NODE_CHANNEL") && !name.starts_with("VEELOE_"))
            .collect();
        Self {
            workdir: workdir.as_ref().to_path_buf(),
            env,
            second_ms,
            sandbox,
        }
    }

}

#[async_trait]
impl ToolRunner for BashTool {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "bash".into(),
            description: DESCRIPTION.into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The command, one line or several." },
                    "timeout": { "type": "number", "description": format!("Seconds before it is stopped. Default {DEFAULT_TIMEOUT_S}, at most {MAX_TIMEOUT_S}.") },
                },
                "required": ["command"],
            }),
        }]
    }

    async fn run(&self, name: &str, input: &Value, cancel: &Cancel) -> Result<String, ToolError> {
        if name != "bash" {
            return Err(ToolError::Unknown(name.into()));
        }
        let command = input
            .get("command")
            .and_then(Value::as_str)
            .filter(|command| !command.trim().is_empty())
            .ok_or_else(|| ToolError::Failed("bash needs a command".into()))?;
        let seconds = input
            .get("timeout")
            .and_then(Value::as_f64)
            .filter(|seconds| *seconds > 0.0)
            .map(|seconds| seconds as u64)
            .unwrap_or(DEFAULT_TIMEOUT_S)
            .min(MAX_TIMEOUT_S);

        // `exec 2>&1` first, so stderr lands in the one pipe in the order it was
        // written. `setsid` makes the child its own process group, so a kill
        // takes everything it started.
        let argv = self.sandbox.wrap(&[
            "bash".to_string(),
            "-c".to_string(),
            format!("exec 2>&1\n{command}"),
        ]);
        let (program, rest) = argv.split_first().expect("a wrapped command");
        let mut command_builder = Command::new(program);
        command_builder
            .args(rest)
            .current_dir(&self.workdir)
            .env_clear()
            .envs(&self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        unsafe {
            command_builder.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
        let mut child = command_builder
            .spawn()
            .map_err(|error| ToolError::Failed(format!("bash could not start: {error}")))?;
        let pid = child.id().unwrap_or_default();

        let mut stdout = child.stdout.take().expect("stdout is piped");
        let reading = tokio::spawn(async move {
            let mut tail = Tail::default();
            let mut buffer = [0u8; 8192];
            loop {
                match stdout.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => tail.add(&buffer[..read]),
                }
            }
            tail
        });

        let deadline = Duration::from_millis(seconds * self.second_ms);
        enum Ending {
            Exited(Option<i32>),
            Stopped,
            TimedOut,
        }
        let ending = {
            let wait = child.wait();
            tokio::pin!(wait);
            tokio::select! {
                status = &mut wait => Ending::Exited(status.ok().and_then(|status| status.code())),
                _ = cancel.cancelled() => Ending::Stopped,
                _ = tokio::time::sleep(deadline) => Ending::TimedOut,
            }
        };
        let (code, stopped, timed_out) = match ending {
            Ending::Exited(code) => (code.unwrap_or(-1), false, false),
            Ending::Stopped => {
                kill_group(pid);
                let _ = child.wait().await;
                (-1, true, false)
            }
            Ending::TimedOut => {
                kill_group(pid);
                let _ = child.wait().await;
                (-1, false, true)
            }
        };
        // What the command left running in the background goes too, or it would
        // hold the output open. One that left the group (setsid) still may, so
        // the output is read for a moment longer at most.
        kill_group(pid);
        let mut tail = match tokio::time::timeout(Duration::from_millis(self.second_ms), reading).await {
            Ok(Ok(tail)) => tail,
            Ok(Err(_)) => Tail::default(),
            Err(_) => Tail::default(),
        };
        let text = tail.trim();
        let cut = if tail.dropped > 0 {
            format!("[the first {} characters were cut]\n", tail.dropped)
        } else {
            String::new()
        };
        let end = if stopped {
            "the owner stopped this Turn before the command finished".to_string()
        } else if timed_out {
            format!("timed out after {seconds} seconds, so it was stopped")
        } else {
            format!("exit code: {code}")
        };
        let separator = if !text.is_empty() && !text.ends_with('\n') {
            "\n"
        } else {
            ""
        };
        let result = format!("{cut}{text}{separator}{end}");
        if stopped || timed_out || code != 0 {
            return Err(ToolError::Failed(result));
        }
        Ok(result)
    }
}

/// Kills the whole process group the command started. Already gone is fine.
fn kill_group(pid: u32) {
    if pid == 0 {
        return;
    }
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
