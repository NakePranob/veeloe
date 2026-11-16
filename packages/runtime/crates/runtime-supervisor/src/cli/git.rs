//! `veeloe git`: what the git broker needs from the Owner (issue #32). The
//! token never goes in an argument, where a shell history would keep it.

use std::path::PathBuf;

use veeloe_runtime_supervisor::agents::AgentRegistry;
use veeloe_runtime_supervisor::git_broker::{is_repo, save_token};

use super::provider::read_key;

pub(crate) fn git(home: PathBuf, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    match args.first().map(String::as_str) {
        Some("token") => {
            let token = read_key("GitHub token")?;
            if token.trim().is_empty() {
                return Err("no token was given, nothing was saved".into());
            }
            save_token(&home, &token)?;
            println!(
                "saved. Agents push through the broker with it; nothing in a sandbox sees it."
            );
            Ok(())
        }
        Some("repos") => {
            let Some(id) = args.get(1) else {
                return Err("usage: veeloe git repos <agent> [owner/name ...]".into());
            };
            let registry = AgentRegistry::open(&home)?;
            let Some(mut agent) = registry.get(id)?.filter(|agent| !agent.deleted()) else {
                return Err(format!("no Agent {id} on this Machine").into());
            };
            if args.len() > 2 {
                let repos: Vec<String> = args[2..]
                    .iter()
                    .map(|repo| repo.to_ascii_lowercase())
                    .collect();
                if let Some(bad) = repos.iter().find(|repo| !is_repo(repo)) {
                    return Err(format!("{bad} is not owner/name").into());
                }
                agent.git_repos = repos;
                registry.replace(&agent)?;
            }
            if agent.git_repos.is_empty() {
                println!("{id} may use no repo");
            }
            for repo in &agent.git_repos {
                println!("{repo}\tpush to veeloe/{id}/*");
            }
            Ok(())
        }
        _ => Err("usage: veeloe git token | veeloe git repos <agent> [owner/name ...]".into()),
    }
}
