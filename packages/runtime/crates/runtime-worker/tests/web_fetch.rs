//! `web_fetch` through a proxy that does what the Egress proxy does: answer for
//! a domain in the Egress, close the connection for one outside it (ADR 0029,
//! 0040). The real proxy refuses loopback, so it cannot stand in here.

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use veeloe_plugin_api::{Cancel, ToolError, ToolRunner};
use veeloe_runtime_worker::tools::web_fetch::{WebFetchTool, TEXT_LIMIT};

/// `allowed.test` is in the Egress, `blocked.test` is not.
async fn egress_proxy() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let url = format!("http://{}", listener.local_addr().expect("addr"));
    tokio::spawn(async move {
        loop {
            let Ok((mut client, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    if client.read(&mut byte).await.unwrap_or(0) == 0 {
                        return;
                    }
                    head.push(byte[0]);
                }
                let head = String::from_utf8_lossy(&head).to_string();
                let target = head
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or_default()
                    .to_string();
                let Some(path) = target.strip_prefix("http://allowed.test") else {
                    // Outside the Egress: the connection is dropped, no answer.
                    return;
                };
                let (status, kind, body, location) = match path {
                    "/page" => (
                        "200 OK",
                        "text/html",
                        "<p>Hello &amp; welcome</p><script>x()</script>".to_string(),
                        None,
                    ),
                    "/big" => ("200 OK", "text/plain", "a".repeat(TEXT_LIMIT + 10), None),
                    "/away" => (
                        "302 Found",
                        "text/plain",
                        String::new(),
                        Some("http://blocked.test/".to_string()),
                    ),
                    loop_path if loop_path.starts_with("/loop/") => {
                        let n: usize = loop_path[6..].parse().unwrap_or(0);
                        (
                            "302 Found",
                            "text/plain",
                            String::new(),
                            Some(format!("http://allowed.test/loop/{}", n + 1)),
                        )
                    }
                    _ => ("404 Not Found", "text/plain", "no".to_string(), None),
                };
                let location = location
                    .map(|to| format!("Location: {to}\r\n"))
                    .unwrap_or_default();
                let answer = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\n{location}Connection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = client.write_all(answer.as_bytes()).await;
            });
        }
    });
    url
}

async fn fetch(proxy: &str, url: &str) -> Result<String, ToolError> {
    WebFetchTool::new(Some(proxy.to_string()))
        .run("web_fetch", &json!({ "url": url }), &Cancel::new())
        .await
}

fn failed(result: Result<String, ToolError>) -> String {
    match result {
        Err(ToolError::Failed(message)) => message,
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[tokio::test]
async fn a_page_in_the_egress_comes_back_as_text() {
    let proxy = egress_proxy().await;
    let text = fetch(&proxy, "http://allowed.test/page")
        .await
        .expect("page");
    assert!(text.starts_with("HTTP 200"), "{text}");
    assert!(text.ends_with("Hello & welcome"), "{text}");
}

#[tokio::test]
async fn a_domain_outside_the_egress_is_refused() {
    let proxy = egress_proxy().await;
    let message = failed(fetch(&proxy, "http://blocked.test/").await);
    assert!(message.starts_with("web_fetch.refused"), "{message}");
    assert!(message.contains("blocked.test"), "{message}");
}

#[tokio::test]
async fn a_redirect_out_of_the_egress_is_refused_too() {
    let proxy = egress_proxy().await;
    let message = failed(fetch(&proxy, "http://allowed.test/away").await);
    assert!(message.starts_with("web_fetch.refused"), "{message}");
}

#[tokio::test]
async fn a_page_past_the_limit_is_cut_and_says_so() {
    let proxy = egress_proxy().await;
    let text = fetch(&proxy, "http://allowed.test/big").await.expect("big");
    assert!(
        text.ends_with("[cut at 100 KB: the page is longer]"),
        "{}",
        &text[text.len() - 60..]
    );
    assert!(text.len() < TEXT_LIMIT + 200);
}

#[tokio::test]
async fn more_than_five_redirects_or_another_scheme_is_refused() {
    let proxy = egress_proxy().await;
    let message = failed(fetch(&proxy, "http://allowed.test/loop/0").await);
    assert!(message.starts_with("web_fetch.redirect"), "{message}");
    let message = failed(fetch(&proxy, "file:///etc/passwd").await);
    assert!(message.starts_with("web_fetch.bad"), "{message}");
}

#[tokio::test]
async fn without_a_proxy_nothing_goes_out() {
    let message = failed(
        WebFetchTool::new(None)
            .run(
                "web_fetch",
                &json!({ "url": "http://allowed.test/page" }),
                &Cancel::new(),
            )
            .await,
    );
    assert!(message.starts_with("web_fetch.refused"), "{message}");
}
