//! `veeloe memory`: the Memory the next Turn's prompt gets from `MEMORY.md`
//! (ADR 0036). Read-only, so it never creates a Workdir or an empty file.

use std::path::{Path, PathBuf};

use veeloe_runtime_core::memory::{read_memory, Memory, MEMORY_LIMIT};

use crate::agents::{agent_root, Agent, AgentError, AgentRegistry};

/// What the command shows: the Agent, where its Memory lives, and what the next
/// Turn's prompt gets.
#[derive(Debug)]
pub struct MemoryView {
    pub agent: Agent,
    pub path: PathBuf,
    pub memory: Memory,
}

#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("no Agent {0} on this Machine")]
    NoAgent(String),
    #[error("{0} is more than one Agent; pass the Agent id")]
    Ambiguous(String),
    #[error(transparent)]
    Agent(#[from] AgentError),
}

impl MemoryError {
    /// A command line the operator can fix (2), not a fault (1).
    pub fn is_usage(&self) -> bool {
        matches!(self, Self::NoAgent(_) | Self::Ambiguous(_))
    }
}

/// `veeloe memory <agent>`: the Memory at the Workdir root, capped the way the
/// prompt is, by Agent id or by name. An Agent in the trash can still be read.
pub fn view(home: &Path, query: &str) -> Result<MemoryView, MemoryError> {
    let agents = AgentRegistry::open(home)?.all()?;
    let agent = find(&agents, query)?;
    let workdir = agent_root(home, &agent.id)?.join("workdir");
    let path = workdir.join("MEMORY.md");
    Ok(MemoryView {
        memory: read_memory(&workdir),
        path,
        agent,
    })
}

fn find(agents: &[Agent], query: &str) -> Result<Agent, MemoryError> {
    if let Some(agent) = agents.iter().find(|agent| agent.id == query) {
        return Ok(agent.clone());
    }
    let mut named = agents.iter().filter(|agent| agent.name == query);
    match (named.next(), named.next()) {
        (Some(agent), None) => Ok(agent.clone()),
        (Some(_), Some(_)) => Err(MemoryError::Ambiguous(query.to_string())),
        _ => Err(MemoryError::NoAgent(query.to_string())),
    }
}

/// Print the header and then the text, in the shape of `veeloe status`.
pub fn run(home: &Path, query: &str, log: &mut dyn FnMut(&str)) -> Result<(), MemoryError> {
    let view = view(home, query)?;
    let mut name = view.agent.name.clone();
    if view.agent.deleted() {
        name.push_str(" (in the trash)");
    }
    log(&format!("Agent       {name}  ({})", view.agent.id));
    log(&format!("Memory      {}", shown(&view.path, home)));
    log(&match (view.memory.exists, view.memory.chars) {
        (false, _) => "            no file, so the prompt has no Memory".to_string(),
        (true, chars) if chars > MEMORY_LIMIT => format!(
            "            {chars} characters; the prompt gets the first {MEMORY_LIMIT} and a note to shorten"
        ),
        (true, chars) => format!("            {chars} characters; the prompt gets all of it"),
    });
    if view.memory.exists {
        log("");
        log(&view.memory.text);
    }
    Ok(())
}

/// The path relative to the Runtime folder reads shorter than a home
/// directory; a path outside it stays absolute.
fn shown(path: &Path, home: &Path) -> String {
    path.strip_prefix(home)
        .map(|rest| rest.display().to_string())
        .unwrap_or_else(|_| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn home_with_agents(agents: &[Value]) -> PathBuf {
        let home = tempdir().expect("dir").keep();
        let runtime = home.join("runtime");
        fs::create_dir_all(&runtime).expect("runtime");
        fs::write(runtime.join("agents.json"), json!(agents).to_string()).expect("agents");
        home
    }

    fn agent(id: &str, name: &str) -> Value {
        json!({ "id": id, "name": name, "provider": "main", "model": "m" })
    }

    fn write_memory(home: &Path, id: &str, text: &str) {
        let workdir = home.join("agents").join(id).join("workdir");
        fs::create_dir_all(&workdir).expect("workdir");
        fs::write(workdir.join("MEMORY.md"), text).expect("memory");
    }

    fn printed(home: &Path, query: &str) -> Vec<String> {
        let mut lines = Vec::new();
        run(home, query, &mut |line| lines.push(line.to_string())).expect("run");
        lines
    }

    #[test]
    fn an_agent_is_found_by_id_or_by_name() {
        let home = home_with_agents(&[agent("a1", "Pang"), agent("a2", "Nok")]);
        assert_eq!(view(&home, "a2").expect("id").agent.name, "Nok");
        assert_eq!(view(&home, "Pang").expect("name").agent.id, "a1");
    }

    #[test]
    fn a_name_that_matches_two_agents_is_refused() {
        let home = home_with_agents(&[agent("a1", "Pang"), agent("a2", "Pang")]);
        let error = view(&home, "Pang").expect_err("ambiguous");
        assert!(error.is_usage());
        assert_eq!(
            error.to_string(),
            "Pang is more than one Agent; pass the Agent id"
        );
    }

    #[test]
    fn an_unknown_agent_is_a_usage_error() {
        let home = home_with_agents(&[agent("a1", "Pang")]);
        let error = view(&home, "Nok").expect_err("missing");
        assert!(error.is_usage());
        assert_eq!(error.to_string(), "no Agent Nok on this Machine");
    }

    #[test]
    fn the_text_is_capped_while_the_count_is_the_whole_file() {
        let home = home_with_agents(&[agent("a1", "Pang")]);
        write_memory(&home, "a1", &"ก".repeat(MEMORY_LIMIT + 10));
        let view = view(&home, "Pang").expect("view");
        assert_eq!(view.memory.chars, MEMORY_LIMIT + 10);
        assert_eq!(
            view.memory.text.chars().count(),
            MEMORY_LIMIT
                + "\n\n(Memory is over the 4,000 character cap. Keep only what every Task needs.)"
                    .chars()
                    .count()
        );
        let lines = printed(&home, "Pang");
        assert_eq!(lines[0], "Agent       Pang  (a1)");
        assert_eq!(lines[1], "Memory      agents/a1/workdir/MEMORY.md");
        assert_eq!(
            lines[2],
            "            4010 characters; the prompt gets the first 4000 and a note to shorten"
        );
        assert_eq!(lines[3], "");
    }

    #[test]
    fn no_file_reads_as_no_memory_and_creates_nothing() {
        let home = home_with_agents(&[agent("a1", "Pang")]);
        let lines = printed(&home, "Pang");
        assert_eq!(lines[2], "            no file, so the prompt has no Memory");
        assert_eq!(lines.len(), 3);
        assert!(
            !home.join("agents").exists(),
            "the Workdir must not be created"
        );
    }

    #[test]
    fn a_trashed_agent_is_read_and_marked() {
        let mut trashed = agent("a1", "Pang");
        trashed["deletedAt"] = json!(1_700_000_000_000i64);
        let home = home_with_agents(&[trashed]);
        write_memory(&home, "a1", "owner likes tea");
        let lines = printed(&home, "Pang");
        assert_eq!(lines[0], "Agent       Pang (in the trash)  (a1)");
        assert_eq!(
            lines[2],
            "            15 characters; the prompt gets all of it"
        );
        assert_eq!(lines[4], "owner likes tea");
    }
}
