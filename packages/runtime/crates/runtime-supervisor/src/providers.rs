//! The Providers set on this Machine, ported from
//! `packages/runtime-legacy/src/supervisor/providers/{store,presets}.ts`.
//!
//! Only the supervisor reads this file, and only it holds a key (ADR 0042). The
//! worker never sees one.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json_file::{read_json_file, write_json_file, JsonFileError};
use crate::trust::{supervisor_dir, TrustError};

/// How this Provider takes its key: Anthropic reads `x-api-key`, gateways such
/// as OpenRouter read a bearer token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Auth {
    #[serde(rename = "x-api-key")]
    ApiKey,
    #[serde(rename = "bearer")]
    Bearer,
}

/// A Provider set on this Machine (ADR 0042).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub url: String,
    pub key: String,
    pub auth: Auth,
    /// The built-in Provider it was added from; none for a custom one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("{0}")]
    File(String),
}

impl From<JsonFileError> for ProviderError {
    fn from(error: JsonFileError) -> Self {
        Self::File(error.to_string())
    }
}

impl From<TrustError> for ProviderError {
    fn from(error: TrustError) -> Self {
        Self::File(error.to_string())
    }
}

/// The built-in Providers, all answering in Anthropic Messages format. Their
/// auth is fixed, not detected: OpenRouter lists models without a key, so
/// detection would pick `x-api-key` for it.
pub const PRESETS: [(&str, &str, &str, Auth); 3] = [
    ("anthropic", "Anthropic", "https://api.anthropic.com", Auth::ApiKey),
    // Go answers 400 MissingSessionID without a session that stays the same for
    // one conversation.
    (
        "opencode-go",
        "OpenCode Go",
        "https://opencode.ai/inference/go",
        Auth::ApiKey,
    ),
    ("openrouter", "OpenRouter", "https://openrouter.ai/api", Auth::Bearer),
];

/// How the Runtime names itself to every Provider; OpenCode asks clients to.
pub fn user_agent() -> String {
    format!("veeloe/{}", env!("CARGO_PKG_VERSION"))
}

pub fn load_providers(home: &Path) -> Result<Vec<Provider>, ProviderError> {
    let file = supervisor_dir(home)?.join("providers.json");
    let Some(value) = read_json_file(&file)? else {
        return Ok(Vec::new());
    };
    let providers = value
        .as_array()
        .map(|providers| {
            providers
                .iter()
                .filter_map(|provider| serde_json::from_value(provider.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    Ok(providers)
}

pub fn save_providers(home: &Path, providers: &[Provider]) -> Result<(), ProviderError> {
    write_json_file(
        &supervisor_dir(home)?.join("providers.json"),
        &serde_json::to_value(providers).unwrap_or(Value::Array(Vec::new())),
    )?;
    Ok(())
}

pub fn auth_headers(provider: &Provider) -> Vec<(String, String)> {
    match provider.auth {
        Auth::Bearer => vec![(
            "authorization".to_string(),
            format!("Bearer {}", provider.key),
        )],
        Auth::ApiKey => vec![("x-api-key".to_string(), provider.key.clone())],
    }
}

/// What every request to this Provider carries: its key, who is asking, and the
/// preset's own headers for the Task it is for.
pub fn upstream_headers(provider: &Provider, task: Option<&str>) -> Vec<(String, String)> {
    let mut headers = auth_headers(provider);
    headers.push(("user-agent".to_string(), user_agent()));
    if let (Some("opencode-go"), Some(task)) = (provider.preset.as_deref(), task) {
        headers.push(("x-opencode-session".to_string(), task.to_string()));
    }
    headers
}
