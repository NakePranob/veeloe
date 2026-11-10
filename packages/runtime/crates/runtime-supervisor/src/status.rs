//! `veeloe status` and the pid file behind "Runtime running", ported from
//! `packages/runtime-legacy/src/supervisor/status.ts`. Never a key.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::agents::AgentRegistry;
use crate::providers::load_providers;
use crate::trust::{load_hub_url, load_trust, machine_name, supervisor_dir};

fn pid_file(home: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(supervisor_dir(home)?.join("supervisor.pid"))
}

/// Marks this process as the supervisor of `home` until it exits, owner-only.
pub fn write_pid_file(home: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut open = std::fs::OpenOptions::new();
    open.write(true).create(true).truncate(true).mode(0o600);
    let mut handle = open.open(pid_file(home)?)?;
    writeln!(handle, "{}", std::process::id())?;
    Ok(())
}

/// Removes the pid file if it still names this process, as the legacy exit hook did.
pub fn remove_pid_file(home: &Path) {
    if supervisor_pid(home) == Some(std::process::id()) {
        if let Ok(file) = pid_file(home) {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// Whether that pid is actually a `veeloe` supervisor: alive, and its command is
/// one, not a number the OS has since given to another program. `ps` answers
/// both at once; a process it cannot see reads as not running.
fn looks_like_supervisor(pid: u32) -> bool {
    let Ok(output) = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let command = String::from_utf8_lossy(&output.stdout);
    // The compiled binary is `veeloe`; run from source it is Bun running `main.ts`.
    command.split_whitespace().any(|word| {
        let name = word.rsplit('/').next().unwrap_or(word);
        name == "veeloe" || name == "main.ts"
    })
}

/// The pid of the supervisor running for `home`, if one is. A file left by one
/// that was killed names a process that is gone, which reads as not running.
pub fn supervisor_pid(home: &Path) -> Option<u32> {
    let raw = std::fs::read_to_string(pid_file(home).ok()?).ok()?;
    let pid: u32 = raw.trim().parse().ok().filter(|pid| *pid > 0)?;
    looks_like_supervisor(pid).then_some(pid)
}

/// `veeloe status`: what is set up on this Machine and what to do next. Never a key.
pub fn run_status(home: &Path, log: &mut dyn FnMut(&str)) {
    let paired = load_trust(home)
        .map(|trust| !trust.owners.is_empty())
        .unwrap_or(false);
    let hub = load_hub_url(home);
    let providers = load_providers(home).unwrap_or_default();
    let agents = AgentRegistry::open(home)
        .and_then(|registry| registry.all())
        .unwrap_or_default();
    let pid = supervisor_pid(home);

    let hub_text = hub.unwrap_or_else(|| "(no Hub URL set)".to_string());
    log(&if paired {
        format!(
            "Machine     paired as {} with hub {hub_text}",
            machine_name()
        )
    } else {
        "Machine     not paired".to_string()
    });
    log(&match pid {
        Some(pid) => format!("Runtime     running (pid {pid})"),
        None => "Runtime     not running".to_string(),
    });
    log(&format!(
        "Providers   {}",
        if providers.is_empty() { "none" } else { "" }
    ));
    for provider in &providers {
        log(&format!(
            "  {}  {}  {}",
            provider.name,
            provider.preset.as_deref().unwrap_or("custom"),
            provider.url
        ));
    }
    log(&format!(
        "Agents      {}",
        if agents.is_empty() { "none" } else { "" }
    ));
    for agent in &agents {
        let provider = if providers.iter().any(|p| p.name == agent.provider) {
            agent.provider.clone()
        } else {
            format!("{} (removed)", agent.provider)
        };
        log(&format!("  {}  {}  {}", agent.name, provider, agent.model));
    }

    let next = if !paired {
        "run veeloe to pair this Machine and add a Provider"
    } else if providers.is_empty() {
        "add a Provider with veeloe provider add"
    } else if pid.is_none() {
        "start the Runtime with veeloe"
    } else if agents.is_empty() {
        "create an Agent in the Veeloe app"
    } else {
        "nothing; message your Agents in the Veeloe app"
    };
    log(&format!("\nNext: {next}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;

    fn home() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("home");
        std::fs::create_dir_all(dir.path().join("runtime")).expect("runtime");
        std::fs::set_permissions(
            dir.path().join("runtime"),
            std::fs::Permissions::from_mode(0o700),
        )
        .expect("mode");
        dir
    }

    fn status(home: &Path) -> Vec<String> {
        let mut lines = Vec::new();
        run_status(home, &mut |line| lines.push(line.to_string()));
        lines
    }

    #[test]
    fn status_names_each_provider_without_its_key_and_says_what_is_next() {
        let dir = home();
        std::fs::write(
            dir.path().join("runtime/providers.json"),
            json!([{ "name": "main", "url": "https://api.anthropic.com", "key": "sk-secret-value", "auth": "x-api-key", "preset": "anthropic" }])
                .to_string(),
        )
        .expect("providers");

        let out = status(dir.path()).join("\n");
        assert!(out.contains("Machine     not paired"), "{out}");
        assert!(out.contains("Runtime     not running"), "{out}");
        assert!(
            out.contains("  main  anthropic  https://api.anthropic.com"),
            "{out}"
        );
        assert!(out.contains("Agents      none"), "{out}");
        assert!(
            out.ends_with("Next: run veeloe to pair this Machine and add a Provider"),
            "{out}"
        );
        assert!(!out.contains("sk-secret-value"), "the key was printed: {out}");
    }

    #[test]
    fn a_pid_file_left_by_a_supervisor_that_is_gone_reads_as_not_running() {
        let dir = home();
        let mut gone = Command::new("true").spawn().expect("true");
        let pid = gone.id();
        let _ = gone.wait();
        std::fs::write(dir.path().join("runtime/supervisor.pid"), format!("{pid}\n")).expect("pid");
        assert_eq!(supervisor_pid(dir.path()), None);

        // Alive and named like the supervisor: this is the one it is.
        let alive = Command::new("/bin/bash")
            .args(["-c", "exec -a veeloe sleep 30"])
            .spawn()
            .expect("bash");
        let pid = alive.id();
        std::fs::write(dir.path().join("runtime/supervisor.pid"), format!("{pid}\n")).expect("pid");
        assert_eq!(supervisor_pid(dir.path()), Some(pid));
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }

    #[test]
    fn a_pid_the_os_has_given_to_another_program_is_not_taken_for_the_supervisor() {
        let dir = home();
        let other = Command::new("/bin/sleep").arg("30").spawn().expect("sleep");
        let pid = other.id();
        std::fs::write(dir.path().join("runtime/supervisor.pid"), format!("{pid}\n")).expect("pid");
        assert_eq!(supervisor_pid(dir.path()), None);
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }

    #[test]
    fn the_runtime_running_and_the_next_step_follow_the_pid_file() {
        let dir = home();
        std::fs::write(
            dir.path().join("runtime/trust.json"),
            json!({ "owners": [{ "member": "member-1", "keys": ["k"] }] }).to_string(),
        )
        .expect("trust");
        std::fs::write(
            dir.path().join("config.json"),
            json!({ "hubUrl": "wss://hub.test" }).to_string(),
        )
        .expect("config");
        std::fs::write(
            dir.path().join("runtime/providers.json"),
            json!([{ "name": "main", "url": "https://api.anthropic.com", "key": "sk", "auth": "x-api-key" }])
                .to_string(),
        )
        .expect("providers");
        std::fs::write(
            dir.path().join("runtime/agents.json"),
            json!([{ "id": "a1", "name": "Deployer", "provider": "gone", "model": "model-a" }])
                .to_string(),
        )
        .expect("agents");

        let out = status(dir.path()).join("\n");
        assert!(out.contains("paired as "), "{out}");
        assert!(out.contains("with hub wss://hub.test"), "{out}");
        assert!(out.contains("  Deployer  gone (removed)  model-a"), "{out}");
        assert!(out.ends_with("Next: start the Runtime with veeloe"), "{out}");

        // A process named like the compiled supervisor, with its pid on file.
        let running = Command::new("/bin/bash")
            .args(["-c", "exec -a veeloe sleep 30"])
            .spawn()
            .expect("a supervisor");
        let pid = running.id();
        std::fs::write(
            dir.path().join("runtime/supervisor.pid"),
            format!("{pid}\n"),
        )
        .expect("pid");
        assert_eq!(supervisor_pid(dir.path()), Some(pid));
        let out = status(dir.path()).join("\n");
        assert!(
            out.contains(&format!("Runtime     running (pid {pid})")),
            "{out}"
        );
        assert!(
            out.ends_with("Next: nothing; message your Agents in the Veeloe app"),
            "{out}"
        );
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}
