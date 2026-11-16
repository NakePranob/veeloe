//! `veeloe pair`, `veeloe unpair` and the first run that pairs before the
//! Runtime starts (ADR 0031).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use veeloe_protocol::hub_auth::normalize_hub_url;
use veeloe_protocol::pairing::PAIRING_TTL_SECONDS;
use veeloe_runtime_supervisor::logs;
use veeloe_runtime_supervisor::pair::{run_pair, PairOptions, PairResult};
use veeloe_runtime_supervisor::providers::load_providers;
use veeloe_runtime_supervisor::trust::{load_hub_url, load_trust, supervisor_dir};

use super::prompt::{ask_line, interactive};
use super::provider::provider;

/// `unpair`: starts this Machine over, as the legacy CLI did (ADR 0031).
///
/// The key goes too: the Hub keeps the old one in the old Workspace and would
/// answer `hub.machine_taken` forever. The Agents and the Egress are forgotten
/// with it, so a new Workspace starts from nothing. The Hub URL stays, because
/// it is where the next `pair` would go.
///
/// Only a person at a terminal may do this, and only with a `y`; a closed stdin
/// or anything else changes nothing, exactly as `askOnTerminal` did.
pub(crate) fn unpair(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    // The question is asked even with no terminal: a closed stdin is a no, and a
    // no exits 1 (legacy `askOnTerminal` + `runUnpairCommand`).
    let answer = ask_line(
        "This Machine will stop trusting every Controller and get a new key. Continue? [y/N] ",
    )?;
    let yes = answer
        .map(|answer| answer.to_lowercase() == "y")
        .unwrap_or(false);
    if !yes {
        println!("nothing was changed");
        std::process::exit(1);
    }

    let dir = supervisor_dir(&home)?;
    for file in ["trust.json", "seen.json", "agents.json", "egress.json"] {
        let _ = std::fs::remove_file(dir.join(file));
    }
    let _ = std::fs::remove_file(home.join("machine.key"));
    println!("unpaired. To pair again, run: veeloe pair");
    Ok(())
}

/// The Hub to pair with, as the legacy CLI took it: `pair --hub <url>`.
/// A bare URL and `--hub=<url>` are accepted too, because both are what an
/// operator copies out of a chat window.
fn hub_argument(args: &[String]) -> Option<String> {
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if let Some(url) = arg.strip_prefix("--hub=") {
            return Some(url.to_string());
        }
        if arg == "--hub" {
            return rest.next().cloned();
        }
        if !arg.starts_with('-') {
            return Some(arg.clone());
        }
    }
    None
}

pub(crate) async fn pair(home: PathBuf, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let hub = hub_argument(args)
        .or_else(|| load_hub_url(&home))
        .ok_or("no Hub URL: run veeloe pair --hub <url>")?;
    let log: veeloe_runtime_supervisor::pair::PairLog = Arc::new(|line: &str| {
        // The link itself is what a phone scans or a person pastes.
        if line.starts_with("veeloe://") {
            println!("{line}");
        } else {
            println!("{line}");
        }
    });
    let mut options = PairOptions::new(&home, hub);
    options.ttl_seconds = PAIRING_TTL_SECONDS;
    let outcome = run_pair(options, log).await?;
    if outcome == PairResult::Paired {
        let _ = logs::record(&home, "info", "pair", json!({}));
    }
    match outcome {
        PairResult::Paired => Ok(()),
        PairResult::AlreadyPaired => Ok(()),
        PairResult::Expired => std::process::exit(1),
    }
}

/// The first run, as the legacy CLI did it (legacy `firstRun`): ask for the Hub
/// URL when there is none, pair, then offer a Provider before starting. True when
/// this Machine is paired and the Supervisor may run.
///
/// With no terminal nothing is asked and nothing is written: the three commands
/// that set the Machine up are named instead, and the Supervisor does not start.
pub(crate) async fn first_run(home: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if !load_trust(home).unwrap_or_default().owners.is_empty() {
        return Ok(true);
    }
    if !interactive() {
        // With no Hub URL, that is the first thing to say.
        match load_hub_url(home) {
            None => eprintln!(
                "veeloe: no Hub URL: run veeloe pair --hub <url>, set \"hubUrl\" in {}, or set the VEELOE_HUB_URL environment variable",
                home.join("config.json").display()
            ),
            Some(_) => eprintln!(
                "veeloe: this Machine is not paired yet. From a terminal, run:\n  veeloe pair       pair it with the Veeloe app\n  veeloe provider add\n  veeloe            start the Runtime"
            ),
        }
        return Ok(false);
    }
    let hub = match load_hub_url(home) {
        Some(hub) => normalize_hub_url(&hub).map_err(|error| error.to_string())?,
        None => {
            let Some(answer) = ask_line("Hub URL (wss://... from the Veeloe app): ")? else {
                return Err(
                    "no Hub URL was given. Run veeloe again, or veeloe pair --hub <url>".into(),
                );
            };
            if answer.is_empty() {
                return Err(
                    "no Hub URL was given. Run veeloe again, or veeloe pair --hub <url>".into(),
                );
            }
            let hub = normalize_hub_url(&answer).map_err(|error| error.to_string())?;
            veeloe_runtime_supervisor::trust::save_hub_url(home, &hub)?;
            hub
        }
    };
    println!("This Machine is not paired yet. Pair it with the Veeloe app first.\n");
    pair(home.to_path_buf(), std::slice::from_ref(&hub)).await?;
    if load_providers(home).unwrap_or_default().is_empty() {
        println!("\nNext, add a Provider: the LLM your Agents use.\n");
        if let Err(error) = provider(home.to_path_buf(), &["add".to_string()]).await {
            println!("{error}\nYou can add one later with: veeloe provider add");
        }
    }
    println!();
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::hub_argument;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn pair_reads_the_hub_url_the_way_the_legacy_cli_did() {
        assert_eq!(
            hub_argument(&args(&["--hub", "ws://127.0.0.1:8080"])),
            Some("ws://127.0.0.1:8080".into())
        );
        assert_eq!(
            hub_argument(&args(&["--hub=wss://hub.example.com"])),
            Some("wss://hub.example.com".into())
        );
        assert_eq!(
            hub_argument(&args(&["ws://127.0.0.1:8080"])),
            Some("ws://127.0.0.1:8080".into())
        );
        assert_eq!(hub_argument(&args(&[])), None);
        assert_eq!(hub_argument(&args(&["--hub"])), None);
    }
}
