//! The git broker (ADR 0069, issue #32): `git` inside an Agent's sandbox
//! reaches GitHub only through it, and never holds a credential.
//!
//! The worker's `git` rewrites `https://github.com/` to `http://HOST/`, so a
//! clone, fetch or push is a plain HTTP request to the Agent's own proxy, which
//! hands it here instead of opening a connection. The broker checks the repo is
//! one the Owner set for that Agent, reads a push's ref updates (they are plain
//! pkt-lines ahead of the pack), and forwards it to GitHub over TLS with the
//! Owner's token added. A push may only create or move branches under
//! `veeloe/<agent>/`: no delete, no tag, never `main`.
//!
//! ponytail: one Owner PAT for the Machine, set with `veeloe git token`. Short
//! lived, repo-scoped tokens (a GitHub App installation token) replace it here
//! without touching the sandbox side.

use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::agents::AgentRegistry;
use crate::json_file::{read_json_file, write_json_file};
use crate::trust::supervisor_dir;

/// The name `git` in the sandbox asks for. `.invalid` never resolves, so it can
/// only ever mean this broker.
pub const HOST: &str = "git.veeloe.invalid";

/// The `GIT_CONFIG_*` a worker gets: the environment outranks every config
/// file, so an Agent editing its `.gitconfig` cannot drop the rewrite and send
/// its pushes past the broker (they would have no token anyway).
pub fn worker_env() -> [(&'static str, String); 3] {
    [
        ("GIT_CONFIG_COUNT", "1".into()),
        ("GIT_CONFIG_KEY_0", format!("url.http://{HOST}/.insteadOf")),
        ("GIT_CONFIG_VALUE_0", "https://github.com/".into()),
    ]
}

/// The largest request body the broker holds in memory: a push's pack.
const MAX_BODY: usize = 256 * 1024 * 1024;

pub struct GitBroker {
    home: PathBuf,
    upstream: String,
    client: reqwest::Client,
}

impl GitBroker {
    pub fn new(home: PathBuf) -> Self {
        Self::with_upstream(home, "https://github.com".into())
    }

    /// The same broker in front of another server; tests only need this.
    pub fn with_upstream(home: PathBuf, upstream: String) -> Self {
        Self {
            home,
            upstream,
            // A redirect (a renamed repo) could lead to a repo outside the
            // Agent's list with the token still on it, so none is followed.
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(30))
                .read_timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("the git broker's HTTP client"),
        }
    }

    /// One request from `agent`'s sandbox, whose head the proxy already read.
    /// Every refusal is an HTTP error with a reason, which `git` prints.
    pub async fn serve<S>(
        &self,
        mut client: S,
        head: &[u8],
        method: &str,
        path: &str,
        agent: &str,
    ) -> std::io::Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        match self.answer(&mut client, head, method, path, agent).await {
            Ok(mut response) => {
                let content_type = response
                    .headers()
                    .get("content-type")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();
                // Streamed, ended by the close: a clone's pack is never held
                // whole in the supervisor's memory.
                let head = format!(
                    "HTTP/1.1 {} Veeloe\r\nContent-Type: {content_type}\r\nConnection: close\r\n\r\n",
                    response.status().as_u16()
                );
                client.write_all(head.as_bytes()).await?;
                while let Ok(Some(chunk)) = response.chunk().await {
                    client.write_all(&chunk).await?;
                }
            }
            Err(reason) => client.write_all(&refusal(&reason)).await?,
        }
        client.shutdown().await
    }

    async fn answer<S>(
        &self,
        client: &mut S,
        head: &[u8],
        method: &str,
        path: &str,
        agent: &str,
    ) -> Result<reqwest::Response, String>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let Some((repo, service, endpoint)) = route(method, path) else {
            return Err("the git broker only carries clone, fetch and push to GitHub".into());
        };
        let repos = AgentRegistry::open(&self.home)
            .ok()
            .and_then(|registry| registry.get(agent).ok().flatten())
            .filter(|agent| !agent.deleted())
            .map(|agent| agent.git_repos)
            .unwrap_or_default();
        if !repos
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(&repo))
        {
            return Err(format!("{repo} is not a repo this Agent may use; the Owner adds it with: veeloe git repos {agent} {repo}"));
        }
        let Some(token) = load_token(&self.home) else {
            return Err(
                "this Machine has no git token; the Owner sets one with: veeloe git token".into(),
            );
        };
        let headers = Headers(head_text(head));
        let body = if method == "POST" {
            if headers
                .get("expect")
                .is_some_and(|value| value.eq_ignore_ascii_case("100-continue"))
            {
                client
                    .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
                    .await
                    .map_err(|error| error.to_string())?;
            }
            read_body(client, head, &headers).await?
        } else {
            Vec::new()
        };
        if service == Service::ReceivePack {
            // A gzipped push could hide its ref updates from the check below.
            if headers.get("content-encoding").is_some() {
                return Err("a push must not be compressed".into());
            }
            check_push(&body, agent)?;
        }

        let url = format!("{}/{repo}.git{endpoint}", self.upstream);
        let mut request = self
            .client
            .request(
                if method == "POST" {
                    reqwest::Method::POST
                } else {
                    reqwest::Method::GET
                },
                url,
            )
            .basic_auth("x-access-token", Some(token));
        for name in [
            "content-type",
            "accept",
            "content-encoding",
            "git-protocol",
            "user-agent",
        ] {
            if let Some(value) = headers.get(name) {
                request = request.header(name, value);
            }
        }
        request
            .body(body)
            .send()
            .await
            .map_err(|_| "GitHub could not be reached".to_string())
    }
}

/// The Owner's token, or none when it was never set.
pub fn load_token(home: &Path) -> Option<String> {
    let file = supervisor_dir(home).ok()?.join("git.json");
    let value = read_json_file(&file).ok()??;
    let token = value.get("token")?.as_str()?.trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// Keeps the Owner's token in the Runtime's own folder, which no sandbox reads
/// (ADR 0069), beside the Provider keys (ADR 0042).
pub fn save_token(home: &Path, token: &str) -> Result<(), String> {
    let file = supervisor_dir(home)
        .map_err(|error| error.to_string())?
        .join("git.json");
    write_json_file(&file, &serde_json::json!({ "token": token.trim() }))
        .map_err(|error| error.to_string())
}

/// Whether `owner/name` can be a GitHub repo.
pub fn is_repo(repo: &str) -> bool {
    let name_ok = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    matches!(repo.split_once('/'), Some((owner, name)) if name_ok(owner) && name_ok(name))
}

#[derive(Debug, PartialEq, Eq)]
enum Service {
    UploadPack,
    ReceivePack,
}

/// `/owner/name[.git]/<smart HTTP endpoint>` as the repo, the service and the
/// endpoint, or none for anything git's smart HTTP does not send.
fn route(method: &str, path: &str) -> Option<(String, Service, &'static str)> {
    let path = path.strip_prefix('/')?;
    let (service, endpoint) = [
        (
            "GET",
            "/info/refs?service=git-upload-pack",
            Service::UploadPack,
        ),
        ("POST", "/git-upload-pack", Service::UploadPack),
        (
            "GET",
            "/info/refs?service=git-receive-pack",
            Service::ReceivePack,
        ),
        ("POST", "/git-receive-pack", Service::ReceivePack),
    ]
    .into_iter()
    .find_map(|(verb, endpoint, service)| {
        (verb == method && path.ends_with(endpoint)).then_some((service, endpoint))
    })?;
    let repo = path[..path.len() - endpoint.len()].trim_end_matches(".git");
    is_repo(repo).then(|| (repo.to_ascii_lowercase(), service, endpoint))
}

/// The ref updates at the start of a push: each must create or move a branch
/// under `veeloe/<agent>/`. Anything the check cannot read is refused.
fn check_push(body: &[u8], agent: &str) -> Result<(), String> {
    let prefix = format!("refs/heads/veeloe/{agent}/");
    let mut at = 0;
    let mut updates = 0;
    loop {
        let length = body
            .get(at..at + 4)
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| usize::from_str_radix(hex, 16).ok())
            .ok_or("the push could not be read")?;
        if length == 0 {
            break;
        }
        let line = body
            .get(at + 4..at + length)
            .ok_or("the push could not be read")?;
        at += length;
        let line = String::from_utf8_lossy(line);
        let line = line
            .split('\0')
            .next()
            .unwrap_or_default()
            .trim_end_matches('\n');
        if line.starts_with("shallow ") {
            continue;
        }
        let mut fields = line.split(' ');
        let (Some(_old), Some(new), Some(name), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Err("the push could not be read".into());
        };
        if new.chars().all(|c| c == '0') {
            return Err(format!("deleting {name} is not allowed"));
        }
        if !name.starts_with(&prefix) || name.len() == prefix.len() {
            return Err(format!(
                "this Agent may only push branches under veeloe/{agent}/, not {name}"
            ));
        }
        updates += 1;
    }
    if updates == 0 {
        return Err("the push names no branch".into());
    }
    Ok(())
}

fn head_text(head: &[u8]) -> String {
    let end = head
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap_or(head.len());
    String::from_utf8_lossy(&head[..end]).into_owned()
}

struct Headers(String);

impl Headers {
    fn get(&self, name: &str) -> Option<&str> {
        self.0.split("\r\n").skip(1).find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
        })
    }
}

/// The request body: what arrived with the head, then the rest, by
/// `Content-Length` or chunked as git sends a large push.
async fn read_body<S: AsyncRead + Unpin>(
    client: &mut S,
    head: &[u8],
    headers: &Headers,
) -> Result<Vec<u8>, String> {
    let start = head
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map_or(head.len(), |at| at + 4);
    let mut buffer = head[start..].to_vec();
    let chunked = headers
        .get("transfer-encoding")
        .is_some_and(|value| value.eq_ignore_ascii_case("chunked"));
    let length: Option<usize> = headers
        .get("content-length")
        .and_then(|value| value.parse().ok());
    if !chunked && length.is_none() {
        return Ok(buffer);
    }
    if length.is_some_and(|length| length > MAX_BODY) {
        return Err("the request is too large".into());
    }
    let mut read = [0u8; 64 * 1024];
    loop {
        if chunked {
            if let Some(body) = dechunk(&buffer)? {
                return Ok(body);
            }
        } else if let Some(length) = length {
            if buffer.len() >= length {
                buffer.truncate(length);
                return Ok(buffer);
            }
        }
        if buffer.len() > MAX_BODY {
            return Err("the request is too large".into());
        }
        let got = client
            .read(&mut read)
            .await
            .map_err(|error| error.to_string())?;
        if got == 0 {
            return Err("the request broke off".into());
        }
        buffer.extend_from_slice(&read[..got]);
    }
}

/// A whole chunked body, `None` while more is still to come.
fn dechunk(raw: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let mut body = Vec::new();
    let mut at = 0;
    loop {
        let Some(line_end) = raw[at..].windows(2).position(|window| window == b"\r\n") else {
            return Ok(None);
        };
        let size_text = String::from_utf8_lossy(&raw[at..at + line_end]);
        let size =
            usize::from_str_radix(size_text.split(';').next().unwrap_or_default().trim(), 16)
                .map_err(|_| "the request could not be read".to_string())?;
        let data = at + line_end + 2;
        if size == 0 {
            // The last chunk, then trailers we do not need, then an empty line.
            return Ok(raw[data..]
                .windows(2)
                .any(|window| window == b"\r\n")
                .then_some(body));
        }
        if raw.len() < data + size + 2 {
            return Ok(None);
        }
        body.extend_from_slice(&raw[data..data + size]);
        at = data + size + 2;
    }
}

/// A refusal `git` prints: an HTTP error with the reason as its body.
fn refusal(reason: &str) -> Vec<u8> {
    let body = format!("veeloe: {reason}\n");
    format!(
        "HTTP/1.1 403 Veeloe\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkt(line: &str) -> Vec<u8> {
        let mut out = format!("{:04x}", line.len() + 4).into_bytes();
        out.extend_from_slice(line.as_bytes());
        out
    }

    fn push(lines: &[&str]) -> Vec<u8> {
        let mut out: Vec<u8> = lines.iter().flat_map(|line| pkt(line)).collect();
        out.extend_from_slice(b"0000PACK....");
        out
    }

    const OLD: &str = "1111111111111111111111111111111111111111";
    const NEW: &str = "2222222222222222222222222222222222222222";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn a_push_to_the_agents_own_branch_goes_through() {
        let body = push(&[&format!(
            "{ZERO} {NEW} refs/heads/veeloe/a1/fix\0report-status side-band-64k\n"
        )]);
        assert_eq!(check_push(&body, "a1"), Ok(()));
        let moved = push(&[&format!("{OLD} {NEW} refs/heads/veeloe/a1/fix\n")]);
        assert_eq!(check_push(&moved, "a1"), Ok(()));
    }

    #[test]
    fn a_push_to_main_another_agents_branch_a_tag_or_a_delete_is_refused() {
        for (line, agent) in [
            (format!("{OLD} {NEW} refs/heads/main"), "a1"),
            (format!("{OLD} {NEW} refs/heads/veeloe/a2/fix"), "a1"),
            (format!("{OLD} {NEW} refs/heads/veeloe/a1/"), "a1"),
            (format!("{OLD} {NEW} refs/heads/veeloe/a1x/fix"), "a1"),
            (format!("{ZERO} {NEW} refs/tags/veeloe/a1/v1"), "a1"),
            (format!("{OLD} {ZERO} refs/heads/veeloe/a1/fix"), "a1"),
        ] {
            assert!(check_push(&push(&[&line]), agent).is_err(), "{line}");
        }
        // One bad update spoils the whole push.
        let mixed = push(&[
            &format!("{OLD} {NEW} refs/heads/veeloe/a1/fix"),
            &format!("{OLD} {NEW} refs/heads/main"),
        ]);
        assert!(check_push(&mixed, "a1").is_err());
        assert!(check_push(b"0000", "a1").is_err());
        assert!(check_push(b"zz", "a1").is_err());
    }

    #[test]
    fn only_smart_http_to_a_repo_is_routed() {
        let upload = "/info/refs?service=git-upload-pack";
        assert_eq!(
            route("GET", "/o/r.git/info/refs?service=git-upload-pack"),
            Some(("o/r".into(), Service::UploadPack, upload))
        );
        assert_eq!(
            route("GET", "/o/r/info/refs?service=git-upload-pack"),
            Some(("o/r".into(), Service::UploadPack, upload))
        );
        assert_eq!(
            route("POST", "/O/R.git/git-receive-pack"),
            Some(("o/r".into(), Service::ReceivePack, "/git-receive-pack"))
        );
        assert_eq!(route("GET", "/o/r.git/HEAD"), None);
        assert_eq!(route("GET", "/o/r.git/git-receive-pack"), None);
        assert_eq!(route("POST", "/../r.git/git-receive-pack"), None);
        assert_eq!(
            route("GET", "/o/r/x.git/info/refs?service=git-upload-pack"),
            None
        );
    }

    #[test]
    fn a_chunked_body_is_whole_only_after_its_last_chunk() {
        assert_eq!(dechunk(b"3\r\nabc\r\n2\r\nde"), Ok(None));
        assert_eq!(
            dechunk(b"3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n"),
            Ok(Some(b"abcde".to_vec()))
        );
        assert!(dechunk(b"zz\r\n").is_err());
    }

    /// A fake GitHub that records each request head and answers 200.
    async fn upstream() -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let url = format!("http://{}", listener.local_addr().expect("addr"));
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let record = std::sync::Arc::clone(&seen);
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = vec![0u8; 64 * 1024];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                record
                    .lock()
                    .expect("seen")
                    .push(String::from_utf8_lossy(&buffer[..read]).into_owned());
                let answer: &[u8] = if record
                    .lock()
                    .expect("seen")
                    .last()
                    .is_some_and(|head| head.contains("/acme/moved.git/"))
                {
                    b"HTTP/1.1 301 Moved\r\nLocation: /acme/secret.git/info/refs?service=git-upload-pack\r\nContent-Length: 0\r\n\r\n"
                } else {
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/x-git-receive-pack-result\r\nContent-Length: 2\r\n\r\nok"
                };
                let _ = socket.write_all(answer).await;
            }
        });
        (url, seen)
    }

    async fn ask(broker: &GitBroker, method: &str, path: &str, body: &[u8]) -> String {
        let (mut ours, theirs) = tokio::io::duplex(1 << 20);
        let mut head = format!(
            "{method} http://{HOST}{path} HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        head.extend_from_slice(body);
        broker
            .serve(theirs, &head, method, path, "a1")
            .await
            .expect("serve");
        let mut answer = String::new();
        ours.read_to_string(&mut answer).await.expect("answer");
        answer
    }

    #[tokio::test]
    async fn the_broker_adds_the_token_and_never_forwards_a_refused_push() {
        let home = tempfile::tempdir().expect("home");
        let runtime = supervisor_dir(home.path()).expect("runtime");
        std::fs::write(runtime.join("agents.json"), serde_json::json!([{ "id": "a1", "name": "A", "provider": "p", "model": "m", "gitRepos": ["acme/shop", "acme/moved"] }]).to_string()).expect("agents");
        let (url, seen) = upstream().await;
        let broker = GitBroker::with_upstream(home.path().to_path_buf(), url);

        // No token yet: refused here, nothing reaches GitHub.
        let answer = ask(
            &broker,
            "GET",
            "/acme/shop.git/info/refs?service=git-upload-pack",
            b"",
        )
        .await;
        assert!(
            answer.starts_with("HTTP/1.1 403") && answer.contains("veeloe git token"),
            "{answer}"
        );

        save_token(home.path(), "ghp_secret\n").expect("token");
        let answer = ask(
            &broker,
            "GET",
            "/acme/shop.git/info/refs?service=git-upload-pack",
            b"",
        )
        .await;
        assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
        // Basic x-access-token:ghp_secret
        assert!(seen.lock().expect("seen")[0].contains("eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA=="));

        let answer = ask(
            &broker,
            "GET",
            "/acme/other.git/info/refs?service=git-upload-pack",
            b"",
        )
        .await;
        assert!(answer.starts_with("HTTP/1.1 403"), "{answer}");

        let to_main = push(&[&format!("{OLD} {NEW} refs/heads/main\0report-status")]);
        let answer = ask(&broker, "POST", "/acme/shop.git/git-receive-pack", &to_main).await;
        assert!(
            answer.starts_with("HTTP/1.1 403") && answer.contains("refs/heads/main"),
            "{answer}"
        );

        let own = push(&[&format!(
            "{ZERO} {NEW} refs/heads/veeloe/a1/fix\0report-status"
        )]);
        let answer = ask(&broker, "POST", "/acme/shop.git/git-receive-pack", &own).await;
        assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
        // The refused ones never left: one fetch, one push.
        assert_eq!(seen.lock().expect("seen").len(), 2);

        // A renamed repo's redirect is handed back, never followed with the
        // token to a repo outside the list.
        let answer = ask(
            &broker,
            "GET",
            "/acme/moved.git/info/refs?service=git-upload-pack",
            b"",
        )
        .await;
        assert!(answer.starts_with("HTTP/1.1 301"), "{answer}");
        assert_eq!(seen.lock().expect("seen").len(), 3);
    }
}
