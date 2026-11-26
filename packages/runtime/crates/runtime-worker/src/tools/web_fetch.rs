//! The `web_fetch` tool: one web page as plain text, through the Agent's own
//! Egress proxy (ADR 0040).
//!
//! It runs in the worker, inside the sandbox, so every hop of a redirect goes
//! through the same proxy a `curl` would and the Egress decides each one. The
//! supervisor never opens a page for the Agent. It is not behind the Allowlist:
//! the Egress already says which domains the Agent may reach.

use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use serde_json::{json, Value};
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRunner};

/// How much text a page gives the model (100 KB), with a note when cut.
pub const TEXT_LIMIT: usize = 100 * 1024;
/// How much of the raw page is read before converting: a page past this is cut.
const BODY_LIMIT: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

const DESCRIPTION: &str = "Fetches one web page (http or https) and returns it as plain text, cut at 100 KB. It reaches only the domains in your Egress; a domain outside it fails, or waits for the owner's Approval. Use it to read a page you already have the URL of.";

pub struct WebFetchTool {
    /// The proxy every connection goes through; none means no way out.
    proxy: Option<String>,
}

impl WebFetchTool {
    pub fn new(proxy: Option<String>) -> Self {
        Self { proxy }
    }

    async fn fetch(&self, url: &str) -> Result<String, ToolError> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|_| ToolError::Failed(format!("web_fetch.bad: {url} is not a URL")))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(ToolError::Failed(format!(
                "web_fetch.bad: only http and https, not {}",
                parsed.scheme()
            )));
        }
        let Some(proxy) = &self.proxy else {
            return Err(ToolError::Failed(
                "web_fetch.refused: this Agent has no way to the network".into(),
            ));
        };
        let proxy = reqwest::Proxy::all(proxy)
            .map_err(|_| ToolError::Failed("web_fetch.refused: the proxy is not usable".into()))?;
        let client = reqwest::Client::builder()
            .proxy(proxy)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > MAX_REDIRECTS {
                    attempt.error("too many redirects")
                } else if !matches!(attempt.url().scheme(), "http" | "https") {
                    attempt.error("a redirect left http and https")
                } else {
                    attempt.follow()
                }
            }))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| ToolError::Failed("web_fetch.refused: no HTTP client".into()))?;
        let mut answer = client.get(parsed).send().await.map_err(|error| {
            if error.is_redirect() {
                return ToolError::Failed(format!(
                    "web_fetch.redirect: more than {MAX_REDIRECTS} redirects, or one left http and https"
                ));
            }
            // The proxy refuses by closing the connection, so a refused domain
            // and a domain that is down look the same here (ADR 0029).
            let host = error
                .url()
                .and_then(|url| url.host_str())
                .unwrap_or_default()
                .to_string();
            ToolError::Failed(format!(
                "web_fetch.refused: could not reach {host}. It is not in this Agent's Egress, the Approval was refused, or it is down"
            ))
        })?;
        let status = answer.status().as_u16();
        let html = answer
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("html"));
        let mut body = Vec::new();
        while let Some(chunk) = answer
            .chunk()
            .await
            .map_err(|_| ToolError::Failed("web_fetch.failed: the page stopped halfway".into()))?
        {
            body.extend_from_slice(&chunk);
            if body.len() >= BODY_LIMIT {
                body.truncate(BODY_LIMIT);
                break;
            }
        }
        let raw = String::from_utf8_lossy(&body);
        let text = if html {
            html_to_text(&raw)
        } else {
            raw.into_owned()
        };
        let (text, cut) = cut_at(text, TEXT_LIMIT);
        let mut out = format!("HTTP {status} {}\n\n{text}", answer.url());
        if cut {
            out.push_str(&format!(
                "\n\n[cut at {} KB: the page is longer]",
                TEXT_LIMIT / 1024
            ));
        }
        Ok(out)
    }
}

/// Cuts on a character boundary at or under `limit` bytes.
fn cut_at(mut text: String, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text, false);
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    (text, true)
}

/// The readable text of an HTML page: no scripts or styles, one line per block.
// ponytail: a regex pass, not a parser; pages that need JavaScript go through
// a Connector instead (ADR 0040).
pub fn html_to_text(html: &str) -> String {
    static DROP: OnceLock<Regex> = OnceLock::new();
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static SPACE: OnceLock<Regex> = OnceLock::new();
    static LINES: OnceLock<Regex> = OnceLock::new();
    let drop = DROP.get_or_init(|| {
        Regex::new(r"(?is)<!--.*?-->|<(script|style|noscript|svg|head)\b.*?</(script|style|noscript|svg|head)\s*>")
            .expect("drop")
    });
    let block = BLOCK.get_or_init(|| {
        Regex::new(r"(?i)<(br|/?p|/?div|/?li|/?tr|/?h[1-6]|/?section|/?article|/?ul|/?ol|/?table|/?pre|/?blockquote)\b[^>]*>")
            .expect("block")
    });
    let tag = TAG.get_or_init(|| Regex::new(r"(?s)<[^>]*>").expect("tag"));
    let space = SPACE.get_or_init(|| Regex::new(r"[ \t\r\f\v]+").expect("space"));
    let lines = LINES.get_or_init(|| Regex::new(r"\n\s*\n+").expect("lines"));
    let text = drop.replace_all(html, "");
    let text = block.replace_all(&text, "\n");
    let text = tag.replace_all(&text, "");
    let text = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let text = space.replace_all(&text, " ");
    let text = lines.replace_all(&text, "\n\n");
    text.lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[async_trait]
impl ToolRunner for WebFetchTool {
    fn definitions(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "web_fetch".into(),
            description: DESCRIPTION.into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "The http or https URL of the page." },
                },
                "required": ["url"],
            }),
        }]
    }

    async fn run(&self, name: &str, input: &Value, cancel: &Cancel) -> Result<String, ToolError> {
        if name != "web_fetch" {
            return Err(ToolError::Unknown(name.into()));
        }
        let url = input
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::Failed("web_fetch.bad: url is required".into()))?;
        tokio::select! {
            _ = cancel.cancelled() => Err(ToolError::Stopped),
            fetched = self.fetch(url) => fetched,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_becomes_its_readable_text() {
        let html = "<html><head><title>x</title><style>p{}</style></head><body><script>alert(1)</script><h1>Title</h1><p>One &amp; two</p><div>three</div></body></html>";
        assert_eq!(html_to_text(html), "Title\n\nOne & two\n\nthree");
    }

    #[test]
    fn a_cut_lands_on_a_character_boundary() {
        let (text, cut) = cut_at("กขค".into(), 4);
        assert!(cut);
        assert_eq!(text, "ก");
    }
}
