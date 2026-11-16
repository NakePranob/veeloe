//! `veeloe provider add|list|remove`: the LLM this Machine talks to (ADR 0042, 0065).

use std::path::PathBuf;

use veeloe_runtime_supervisor::agents::AgentRegistry;
use veeloe_runtime_supervisor::models;
use veeloe_runtime_supervisor::providers::load_providers;

use super::prompt::{ask_line, ask_valid, interactive, pick_with_arrows};
use crate::ReqwestClient;

/// A Provider's name: lower-case letters, digits and dashes, up to 32 (legacy
/// `checkName`).
fn provider_name(
    name: &str,
    providers: &[veeloe_runtime_supervisor::providers::Provider],
) -> Result<String, String> {
    let allowed = !name.is_empty()
        && name.len() <= 32
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !allowed {
        return Err(format!(
            "a Provider name is lower-case letters, digits and dashes, up to 32, got \"{name}\""
        ));
    }
    if providers.iter().any(|provider| provider.name == name) {
        return Err(format!(
            "a Provider named {name} already exists. Pick another name, or remove it first: veeloe provider remove {name}"
        ));
    }
    Ok(name.to_string())
}

/// A base URL without a trailing slash. Plain http only to this Machine, so a key
/// never crosses a network in clear (legacy `providerUrl`).
fn provider_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| format!("not a URL: {raw}"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(format!(
            "the Provider URL must start with https:// (http:// only for this machine), got {raw}"
        ));
    }
    if url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!("the Provider URL must be just its base, got {raw}"));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// The Provider's key: typed hidden at a terminal, read whole from stdin
/// anywhere else (legacy `readKey`).
fn read_key() -> Result<String, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    if !interactive() {
        let mut key = String::new();
        std::io::stdin().read_to_string(&mut key)?;
        return Ok(key);
    }
    // The tty driver does not echo while this line is typed, so the key never
    // lands on the screen or in a scrollback.
    let quiet = std::process::Command::new("stty")
        .arg("-echo")
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    print!("Provider key: ");
    std::io::stdout().flush()?;
    let mut line = String::new();
    let read = std::io::stdin().read_line(&mut line);
    if quiet {
        let _ = std::process::Command::new("stty").arg("echo").status();
    }
    println!();
    read?;
    Ok(line)
}

/// What a Provider that would not list its models is told, as the legacy CLI
/// put it (`providers/cli.ts`).
fn provider_problem(problem: &str) -> &'static str {
    match problem {
        "provider.rejected" => {
            "the Provider refused this key. Check the key and run veeloe provider add again"
        }
        "provider.unreachable" => {
            "could not reach the Provider at that URL. Check the URL and your connection, then run veeloe provider add again"
        }
        _ => "the Provider answered with an error. Try again later, or check the URL",
    }
}

/// `provider add|list|remove`: the LLM this Machine talks to. The key is typed
/// hidden or piped in, never an argument (ADR 0042, 0065). At a terminal a
/// missing choice is asked; anywhere else it is named and nothing is asked
/// (legacy `runProviderCommand`).
pub(crate) async fn provider(
    home: PathBuf,
    args: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    use veeloe_runtime_supervisor::providers::{save_providers, PRESETS};
    let action = args.first().map(String::as_str).unwrap_or("list");
    let providers = load_providers(&home).unwrap_or_default();
    let flag = |name: &str| -> Option<String> {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };
    match action {
        "list" => {
            if providers.is_empty() {
                println!("no Provider yet. Add one with: veeloe provider add");
            }
            for provider in &providers {
                println!("{}\t{}", provider.name, provider.url);
            }
            Ok(())
        }
        "add" => {
            let mut preset = flag("--preset");
            let mut name = flag("--name");
            let given_url = flag("--url");
            if preset.is_none() && name.is_none() && given_url.is_none() && interactive() {
                let labels: Vec<String> = PRESETS
                    .iter()
                    .map(|(_, label, _, _)| label.to_string())
                    .chain(std::iter::once("Custom (enter a URL)".to_string()))
                    .collect();
                let Some(picked) = pick_with_arrows("Which Provider do you want to add?", &labels)?
                else {
                    return Err("cancelled, nothing was saved".into());
                };
                preset = PRESETS.get(picked).map(|(id, _, _, _)| id.to_string());
            }
            let (url, fixed_auth, preset) = match preset.as_deref() {
                Some(id) => {
                    let Some((id, _, url, auth)) = PRESETS.iter().find(|(name, ..)| *name == id)
                    else {
                        let ids: Vec<&str> = PRESETS.iter().map(|(id, ..)| *id).collect();
                        return Err(format!(
                            "no built-in Provider {id}. Pick one of: {}",
                            ids.join(", ")
                        )
                        .into());
                    };
                    if given_url.is_some() {
                        return Err(format!(
                            "--preset {id} sets its own URL; drop --url, or leave out --preset for a custom Provider"
                        )
                        .into());
                    }
                    (url.to_string(), Some(*auth), Some(id.to_string()))
                }
                None => {
                    // A custom Provider is named first, then its URL, as the
                    // legacy wizard asked.
                    if name.is_none() {
                        if !interactive() {
                            let ids: Vec<&str> = PRESETS.iter().map(|(id, ..)| *id).collect();
                            return Err(format!(
                                "missing --name: veeloe provider add --name <name> --url <base url> (a name is lower-case letters, digits and dashes, up to 32), or --preset <{}>",
                                ids.join("|")
                            )
                            .into());
                        }
                        name = Some(ask_valid("Name for this Provider: ", |answer| {
                            provider_name(answer, &providers)
                        })?);
                    }
                    let url = match given_url {
                        Some(url) => provider_url(&url)?,
                        None if interactive() => ask_valid(
                            "Base URL (such as https://api.anthropic.com): ",
                            provider_url,
                        )?,
                        None => {
                            return Err(
                                "missing --url: give the Provider's base URL, such as --url https://api.anthropic.com"
                                    .into(),
                            )
                        }
                    };
                    (url, None, None)
                }
            };
            let name = match (name, preset.as_deref()) {
                (Some(name), _) => provider_name(&name, &providers)?,
                (None, Some(id)) => provider_name(id, &providers)?,
                // Unreachable: a custom Provider was named above.
                (None, None) => return Err("missing --name".into()),
            };
            // The key never lands in shell history or `ps`: typed hidden here, or
            // piped in on stdin.
            let key = read_key()?.trim().to_string();
            if key.is_empty() {
                return Err(
                    "no key was given. Type it when asked, or pipe it in: veeloe provider add ... < key-file"
                        .into(),
                );
            }
            let http = ReqwestClient::cli();
            println!("checking {url} ...");
            let auth = match fixed_auth {
                Some(auth) => {
                    match models::list_models(&url, &key, auth, preset.as_deref(), &http).await {
                        Ok(models) => {
                            println!("saved {name} with {} models", models.len());
                            auth
                        }
                        Err(problem) => {
                            println!("not saved: {}", provider_problem(problem));
                            std::process::exit(1);
                        }
                    }
                }
                None => match models::detect_auth(&url, &key, preset.as_deref(), &http).await {
                    Ok((auth, models)) => {
                        println!("saved {name} with {} models", models.len());
                        auth
                    }
                    Err(problem) => {
                        println!("not saved: {}", provider_problem(problem));
                        std::process::exit(1);
                    }
                },
            };
            let mut saved = providers.clone();
            saved.push(veeloe_runtime_supervisor::providers::Provider {
                name: name.clone(),
                url,
                key,
                auth,
                preset,
            });
            save_providers(&home, &saved)?;
            println!("Next: create an Agent with it in the Veeloe app. Start the Runtime with veeloe if it is not running.");
            Ok(())
        }
        "remove" => {
            if providers.is_empty() {
                println!("there is no Provider to remove. Add one with: veeloe provider add");
                std::process::exit(1);
            }
            let mut name = args
                .iter()
                .skip(1)
                .find(|arg| !arg.starts_with("--"))
                .cloned();
            if name.is_none() {
                if !interactive() {
                    return Err(
                        "missing the Provider's name: veeloe provider remove <name> --yes (see them with: veeloe provider list)"
                            .into(),
                    );
                }
                let labels: Vec<String> = providers
                    .iter()
                    .map(|provider| format!("{}  {}", provider.name, provider.url))
                    .collect();
                let Some(picked) =
                    pick_with_arrows("Which Provider do you want to remove?", &labels)?
                else {
                    return Err("cancelled, nothing was removed".into());
                };
                name = Some(providers[picked].name.clone());
            }
            let name = name.expect("a name");
            if !providers.iter().any(|provider| provider.name == name) {
                println!("no Provider named {name}. See them with: veeloe provider list");
                std::process::exit(1);
            }
            let users: Vec<String> = AgentRegistry::open(&home)
                .map(|registry| registry.all().unwrap_or_default())
                .unwrap_or_default()
                .into_iter()
                .filter(|agent| !agent.deleted() && agent.provider == name)
                .map(|agent| agent.name)
                .collect();
            if users.is_empty() {
                println!("no Agent uses {name}.");
            } else {
                println!(
                    "Agents using {name}: {}. They stop answering until you pick another Provider for them on the Agent's page in the Veeloe app.",
                    users.join(", ")
                );
            }
            if !args.iter().any(|arg| arg == "--yes") {
                if !interactive() {
                    return Err(format!(
                        "not removed: there is no terminal to confirm on. Run it again with --yes: veeloe provider remove {name} --yes"
                    )
                    .into());
                }
                let answer = ask_line(&format!("Remove {name}? [y/N] "))?;
                // A yes only when the answer is y; Enter or anything else keeps it.
                if answer.unwrap_or_default().to_lowercase() != "y" {
                    println!("nothing was removed");
                    std::process::exit(1);
                }
            }
            let saved: Vec<_> = providers
                .into_iter()
                .filter(|provider| provider.name != name)
                .collect();
            save_providers(&home, &saved)?;
            println!("removed {name}. Next: add another with veeloe provider add, or see what is left with veeloe status");
            Ok(())
        }
        other => Err(format!("unknown provider command: {other}").into()),
    }
}
