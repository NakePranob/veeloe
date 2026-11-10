//! What a Provider offers, as the Controller's model picker sees it. The key
//! stays here: the Controller gets model ids and names, never the key or URL
//! (ADR 0042).

use serde_json::{json, Value};

use crate::llm::HttpClient;
use crate::providers::{upstream_headers, Auth, Provider};

/// How many pages of models one Provider may have. A stuck cursor stops sooner.
const MAX_PAGES: usize = 10;

/// A Provider as `agent.listed` carries it: its models, or the code saying why
/// there are none. Never a key.
pub async fn info(providers: &[Provider], http: &dyn HttpClient) -> Vec<Value> {
    let mut listed = Vec::with_capacity(providers.len());
    for provider in providers {
        listed.push(match list(provider, http).await {
            Ok(models) => json!({ "name": provider.name, "models": models }),
            Err(problem) => json!({ "name": provider.name, "error": problem }),
        });
    }
    listed
}

/// The model ids a Provider lists, or the code the Controller shows.
pub async fn list(provider: &Provider, http: &dyn HttpClient) -> Result<Vec<Value>, &'static str> {
    list_models(
        &provider.url,
        &provider.key,
        provider.auth,
        provider.preset.as_deref(),
        http,
    )
    .await
}

/// Which header this Provider wants the key in: the first that lists models
/// (legacy `detectAuth`). A Provider that refuses keeps a 401/403, and both
/// headers are tried before that is believed.
pub async fn detect_auth(
    url: &str,
    key: &str,
    preset: Option<&str>,
    http: &dyn HttpClient,
) -> Result<(Auth, Vec<Value>), &'static str> {
    let mut last: &'static str = "provider.rejected";
    for auth in [Auth::ApiKey, Auth::Bearer] {
        match list_models(url, key, auth, preset, http).await {
            Ok(models) => return Ok((auth, models)),
            Err(problem) if problem != "provider.rejected" => return Err(problem),
            Err(problem) => last = problem,
        }
    }
    Err(last)
}

/// The models a Provider offers with this key and this way of sending it.
pub async fn list_models(
    url: &str,
    key: &str,
    auth: Auth,
    preset: Option<&str>,
    http: &dyn HttpClient,
) -> Result<Vec<Value>, &'static str> {
    let provider = Provider {
        name: String::new(),
        url: url.to_string(),
        key: key.to_string(),
        auth,
        preset: preset.map(str::to_string),
    };
    let mut models = Vec::new();
    let mut after: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let query = match &after {
            Some(after) => format!("limit=1000&after_id={}", encode(after)),
            None => "limit=1000".to_string(),
        };
        let mut headers = upstream_headers(&provider, None);
        headers.push(("anthropic-version".to_string(), "2023-06-01".to_string()));
        let answer = http
            .get(&format!("{}/v1/models?{query}", provider.url), headers)
            .await
            .map_err(|_| "provider.unreachable")?;
        if answer.status == 401 || answer.status == 403 {
            return Err("provider.rejected");
        }
        if !(200..300).contains(&answer.status) {
            return Err("provider.failed");
        }
        let Ok(body) = serde_json::from_str::<Value>(&answer.body) else {
            return Err("provider.failed");
        };
        for entry in body.get("data").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            if id.is_empty() {
                continue;
            }
            let name = entry
                .get("display_name")
                .and_then(Value::as_str)
                .or_else(|| entry.get("name").and_then(Value::as_str));
            models.push(match name {
                Some(name) => json!({ "id": id, "name": name }),
                None => json!({ "id": id }),
            });
        }
        // Another page only when the Provider says so and names where it goes
        // on; a cursor that does not move stops the walk.
        let next = body
            .get("last_id")
            .and_then(Value::as_str)
            .filter(|next| !next.is_empty());
        if body.get("has_more") != Some(&Value::Bool(true)) || next.is_none() || next == after.as_deref() {
            break;
        }
        after = next.map(str::to_string);
    }
    Ok(models)
}

/// Percent-encodes what a Provider may hand back as a cursor.
fn encode(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}
