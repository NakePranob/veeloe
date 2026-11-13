//! The local proxy each Agent's sandboxed commands reach the network through
//! (ADR 0008, 0029, issue #43).
//!
//! Seatbelt cannot match a domain, and a list the kernel cannot check is not a
//! rule. So the sandbox allows exactly one outbound address, this Agent's proxy
//! on localhost, and the proxy decides per connection whether *that Agent's*
//! Egress lets the host out. It is read on every connection, so `egress.set`
//! takes effect without starting a worker again.
//!
//! One listener per Agent: a request that arrives on A's listener is checked
//! against A's list and never B's, so A cannot borrow B's way out (ADR 0029).
//! Two transports carry the same requests to the same checks: TCP on loopback
//! for macOS, whose profile allows that one port, and a Unix socket for Linux,
//! which has no route to the supervisor at all and gets the socket bound into
//! its network namespace (ADR 0069).

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::egress::Egress;

/// The largest request head a client may send before the proxy gives up.
const MAX_HEAD: usize = 16 * 1024;

/// A running proxy: the URL one Agent's commands get, the port the sandbox
/// allows, and the socket its namespace gets on Linux.
pub struct Proxy {
    pub url: String,
    pub port: u16,
    /// The Unix socket it also answers on, where the Machine has one.
    pub socket: Option<PathBuf>,
    tasks: Vec<JoinHandle<()>>,
}

/// What the wrap needs of one Agent's proxy, copied out of the registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyView {
    pub url: String,
    pub port: u16,
    pub socket: Option<PathBuf>,
}

impl Proxy {
    pub fn view(&self) -> ProxyView {
        ProxyView {
            url: self.url.clone(),
            port: self.port,
            socket: self.socket.clone(),
        }
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        // The listener closes with its task, so an Agent that is gone stops
        // taking requests at once (ADR 0029).
        for task in &self.tasks {
            task.abort();
        }
    }
}

/// Where one Agent's proxy Unix socket sits:
/// `<VEELOE_HOME>/runtime/egress/<agent>.sock`, in the Runtime's own folder,
/// out of reach of what a command may write (ADR 0069).
pub fn socket_path(home: &Path, agent: &str) -> PathBuf {
    home.join("runtime").join("egress").join(format!("{agent}.sock"))
}

/// Starts the proxy on a free loopback port. It runs until the process ends.
pub async fn start(egress: Arc<Egress>, agent: &str) -> std::io::Result<Proxy> {
    start_avoiding(egress, agent, &|_| false).await
}

/// Starts the proxy on a free loopback port that `avoid` accepts. The Agent
/// ranges are reserved before the proxy opens, and a port inside a range is a
/// port a command may bind, so the proxy steps out of their way instead of
/// taking one that was already given away (ADR 0069).
pub async fn start_avoiding(
    egress: Arc<Egress>,
    agent: &str,
    avoid: &(dyn Fn(u16) -> bool + Send + Sync),
) -> std::io::Result<Proxy> {
    start_with_socket(egress, agent, avoid, None).await
}

/// Starts one Agent's proxy on a free loopback port and, when `socket` names a
/// path, on that Unix socket too, so its Linux worker can reach it from inside
/// its own network namespace (ADR 0069). Both listeners go through one `serve`,
/// so an Egress check is never weaker on one of them, and both answer with this
/// Agent's list only.
pub async fn start_with_socket(
    egress: Arc<Egress>,
    agent: &str,
    avoid: &(dyn Fn(u16) -> bool + Send + Sync),
    socket: Option<&Path>,
) -> std::io::Result<Proxy> {
    let agent: Arc<str> = Arc::from(agent);
    for _ in 0..16 {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        if avoid(port) {
            // Dropping the listener closes it, so the next try binds anew.
            drop(listener);
            continue;
        }
        let mut tasks = vec![tokio::spawn(accepting(
            listener,
            Arc::clone(&egress),
            Arc::clone(&agent),
        ))];
        let socket = match socket {
            Some(path) => {
                let (path, task) = listen_unix(path, Arc::clone(&egress), Arc::clone(&agent)).await?;
                tasks.push(task);
                Some(path)
            }
            None => None,
        };
        return Ok(Proxy {
            url: format!("http://127.0.0.1:{port}"),
            port,
            socket,
            tasks,
        });
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AddrNotAvailable,
        "no free loopback port outside the Agents' ranges",
    ))
}

/// One Agent's TCP listener: every connection is answered with that Agent's
/// Egress, whichever Agent asked.
async fn accepting(listener: TcpListener, egress: Arc<Egress>, agent: Arc<str>) {
    loop {
        let Ok((client, _)) = listener.accept().await else {
            break;
        };
        let egress = Arc::clone(&egress);
        let agent = Arc::clone(&agent);
        tokio::spawn(async move {
            let _ = serve(client, egress, agent).await;
        });
    }
}

/// A Unix listener on `path`, answering with the same `serve` as TCP. A file
/// left by a Runtime that did not end cleanly is taken over rather than
/// blocking every start after it.
async fn listen_unix(
    path: &Path,
    egress: Arc<Egress>,
    agent: Arc<str>,
) -> std::io::Result<(PathBuf, JoinHandle<()>)> {
    use std::os::unix::fs::PermissionsExt;

    let _ = std::fs::remove_file(path);
    let listener = tokio::net::UnixListener::bind(path)?;
    // Only this Machine's owner, and so only workers under it, may ask this
    // socket for a way out. The folder is already the Runtime's alone; the file
    // says so itself as well.
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    let path = path.to_path_buf();
    let task = tokio::spawn(async move {
        loop {
            let Ok((client, _)) = listener.accept().await else {
                break;
            };
            let egress = Arc::clone(&egress);
            let agent = Arc::clone(&agent);
            tokio::spawn(async move {
                let _ = serve(client, egress, agent).await;
            });
        }
    });
    Ok((path, task))
}

/// Every Agent's proxy on this Machine, started when its Agent gets a worker
/// and stopped when it no longer has one (issue #43).
pub struct Proxies {
    home: PathBuf,
    egress: Arc<Egress>,
    running: Mutex<HashMap<String, Proxy>>,
    /// One start at a time, so two calls for the same Agent cannot both bind
    /// its socket and leave the winner's path pointing at the loser.
    starting: tokio::sync::Mutex<()>,
}

impl Proxies {
    pub fn new(home: PathBuf, egress: Arc<Egress>) -> Self {
        Self {
            home,
            egress,
            running: Mutex::new(HashMap::new()),
            starting: tokio::sync::Mutex::new(()),
        }
    }

    /// This Agent's proxy, or `None` when it has none: its worker is then not
    /// started at all rather than started with no way out.
    pub fn get(&self, agent: &str) -> Option<ProxyView> {
        self.running
            .lock()
            .expect("proxies")
            .get(agent)
            .map(Proxy::view)
    }

    /// The ports every Agent's proxy listens on, so no free range is handed to
    /// a command on top of one (ADR 0069).
    pub fn ports(&self) -> Vec<u16> {
        self.running
            .lock()
            .expect("proxies")
            .values()
            .map(|proxy| proxy.port)
            .collect()
    }

    /// One Agent's proxy, started if it is not running. The same call twice
    /// gives back the same listener, so a worker that restarts keeps its URL.
    pub async fn ensure(&self, agent: &str) -> std::io::Result<ProxyView> {
        let _starting = self.starting.lock().await;
        if let Some(view) = self.get(agent) {
            return Ok(view);
        }
        // An id that is not a folder name never names a socket.
        crate::agents::agent_root(&self.home, agent)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error.to_string()))?;
        let ports = crate::ports::Ports::open(&self.home)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        #[cfg(target_os = "linux")]
        let socket = Some(socket_path(&self.home, agent));
        #[cfg(not(target_os = "linux"))]
        let socket: Option<PathBuf> = None;
        if let Some(path) = &socket {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
        let taken = self.ports();
        let proxy = start_with_socket(
            Arc::clone(&self.egress),
            agent,
            &|port| ports.is_taken(port) || taken.contains(&port),
            socket.as_deref(),
        )
        .await?;
        let view = proxy.view();
        self.running
            .lock()
            .expect("proxies")
            .insert(agent.to_string(), proxy);
        Ok(view)
    }

    /// The Agent has no worker any more: its listener closes, and its socket
    /// goes with it. Starting it again later opens both anew.
    pub fn stop(&self, agent: &str) {
        let proxy = self.running.lock().expect("proxies").remove(agent);
        if let Some(proxy) = proxy {
            if let Some(socket) = &proxy.socket {
                let _ = std::fs::remove_file(socket);
            }
        }
    }

    /// Every listener, for good: the supervisor is ending.
    pub fn stop_all(&self) {
        let mut running = self.running.lock().expect("proxies");
        for (_, proxy) in running.drain() {
            if let Some(socket) = &proxy.socket {
                let _ = std::fs::remove_file(socket);
            }
        }
    }
}

/// One client: read its CONNECT, check the host against this Agent's Egress,
/// then copy bytes both ways.
async fn serve<S>(mut client: S, egress: Arc<Egress>, agent: Arc<str>) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut head = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let read = client.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        head.extend_from_slice(&buffer[..read]);
        if head.len() > MAX_HEAD {
            return Ok(());
        }
        if head.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let header_end = head
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap_or(head.len());
    let text = String::from_utf8_lossy(&head[..header_end]);
    let Some(request) = text.lines().next() else {
        return Ok(());
    };
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    let (host, port, plain_path) = if method == "CONNECT" {
        let Some((host, port)) = split_host_port(target) else {
            return Ok(());
        };
        (host, port, None)
    } else {
        // A plain HTTP request carries the whole URL; rewrite it to the
        // origin-form the server expects.
        let Some((host, port, path)) = split_absolute(target) else {
            return Ok(());
        };
        (host, port, Some(path))
    };
    if !allowed(&host, &egress.current(&agent)) {
        // No answer at all: a 403 is still an HTTP response a command could
        // treat as success. Dropping the connection is the refusal.
        return Ok(());
    }

    let Some(address) = public_address(&host, port).await else {
        return Ok(());
    };
    let mut upstream = TcpStream::connect(address).await?;
    match plain_path {
        None => {
            client
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await?;
        }
        Some(path) => {
            upstream
                .write_all(&plain_request(&head, method, &path, &host, port))
                .await?;
        }
    }
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

/// One plain HTTP request in origin-form, with the proxy's own headers dropped
/// and whatever body arrived with the head kept after it.
fn plain_request(head: &[u8], method: &str, path: &str, host: &str, port: u16) -> Vec<u8> {
    let header_end = head
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap_or(head.len());
    let body_start = (header_end + 4).min(head.len());
    let text = String::from_utf8_lossy(&head[..header_end]);
    let mut lines = text.split("\r\n");
    let _ = lines.next();
    let mut forwarded = format!("{method} {path} HTTP/1.1\r\n");
    for line in lines {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("proxy-connection:")
            || lower.starts_with("proxy-authorization:")
            || lower.starts_with("connection:")
            || lower.starts_with("host:")
            || line.is_empty()
        {
            continue;
        }
        forwarded.push_str(line);
        forwarded.push_str("\r\n");
    }
    forwarded.push_str(&format!(
        "Host: {host}{}\r\n",
        if port == 80 {
            String::new()
        } else {
            format!(":{port}")
        }
    ));
    // One request per connection, so the answer has an end.
    forwarded.push_str("Connection: close\r\n\r\n");
    let mut out = forwarded.into_bytes();
    out.extend_from_slice(&head[body_start..]);
    out
}

/// `example.com:443`, or none when the target is not a host and a port.
fn split_host_port(target: &str) -> Option<(String, u16)> {
    let (host, port) = target.rsplit_once(':')?;
    if host.is_empty() {
        return None;
    }
    let port: u16 = port.parse().ok()?;
    Some((host.trim_matches(['[', ']']).to_string(), port))
}

/// `http://example.com:8080/a?b`, as the host, the port and the path to ask for.
fn split_absolute(target: &str) -> Option<(String, u16, String)> {
    let rest = target.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()?),
        None => (authority, 80),
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port, path.to_string()))
}

/// Whether the Egress names this host: an exact domain, or `*.example.com`
/// for its subdomains. An address is never a domain.
fn allowed(host: &str, domains: &[String]) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() {
        return false;
    }
    domains.iter().any(|domain| {
        let domain = domain.trim_end_matches('.').to_ascii_lowercase();
        if domain == "*" {
            return true;
        }
        match domain.strip_prefix("*.") {
            Some(suffix) => host.len() > suffix.len() && host.ends_with(&format!(".{suffix}")),
            None => host == domain,
        }
    })
}

/// The first address `host` resolves to that is on the public internet. A
/// domain that points at loopback or a private network is refused here, not by
/// the list (ADR 0029).
async fn public_address(host: &str, port: u16) -> Option<SocketAddr> {
    let addresses = lookup_host((host, port)).await.ok()?;
    addresses.into_iter().find(|address| public(address.ip()))
}

fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            // A v4 address written as a v6 one (`::ffff:127.0.0.1`) is still
            // that v4 address, and the rules above are the ones that decide.
            if let Some(ip) = ip.to_ipv4_mapped() {
                return public(IpAddr::V4(ip));
            }
            let first = ip.segments()[0];
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || first & 0xfe00 == 0xfc00
                || first & 0xffc0 == 0xfe80)
        }
    }
}

/// A v4 address on the public internet: not loopback, private, carrier-grade
/// NAT, link-local, documentation, benchmarking, reserved or multicast.
fn public_v4(ip: std::net::Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_broadcast()
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || octets[0] >= 240
        || octets[0] == 0
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn a_domain_matches_exactly_or_through_a_wildcard() {
        let domains = vec!["example.com".to_string(), "*.npmjs.org".to_string()];
        assert!(allowed("example.com", &domains));
        assert!(allowed("EXAMPLE.com.", &domains));
        assert!(allowed("registry.npmjs.org", &domains));
        assert!(!allowed("npmjs.org", &domains));
        assert!(!allowed("evil-example.com", &domains));
        assert!(!allowed("127.0.0.1", &domains));
        assert!(!allowed("example.com.evil.test", &domains));
    }

    #[test]
    fn only_public_addresses_are_reached() {
        assert!(public("93.184.216.34".parse().unwrap()));
        assert!(!public("127.0.0.1".parse().unwrap()));
        assert!(!public("10.0.0.1".parse().unwrap()));
        assert!(!public("169.254.169.254".parse().unwrap()));
        assert!(!public("100.64.0.1".parse().unwrap()));
        assert!(!public("198.18.0.1".parse().unwrap()));
        assert!(!public("240.0.0.1".parse().unwrap()));
        assert!(!public("192.0.2.1".parse().unwrap()));
        assert!(!public("::1".parse().unwrap()));
        assert!(!public("::ffff:127.0.0.1".parse().unwrap()));
        assert!(!public("fd00::1".parse().unwrap()));
        assert!(!public("fe80::1".parse().unwrap()));
    }

    #[test]
    fn a_plain_request_keeps_its_body_and_drops_proxy_headers() {
        let head = b"POST http://example.com/x HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: Basic x\r\nContent-Length: 5\r\n\r\nhello";
        let out =
            String::from_utf8(plain_request(head, "POST", "/x", "example.com", 80)).unwrap();
        assert!(out.starts_with("POST /x HTTP/1.1\r\n"));
        assert!(out.contains("Host: example.com\r\n"));
        assert!(!out.to_ascii_lowercase().contains("proxy-authorization"));
        assert!(out.ends_with("\r\n\r\nhello"));
    }

    fn egress_with(home: &Path, agents: &[(&str, &[&str])]) -> Arc<Egress> {
        let registry = crate::agents::AgentRegistry::open(home).expect("registry");
        for (id, domains) in agents {
            registry
                .add(&crate::agents::Agent {
                    id: (*id).to_string(),
                    name: (*id).to_string(),
                    provider: "main".into(),
                    model: "model-a".into(),
                    character: None,
                    allowlist: Vec::new(),
                    egress: domains.iter().map(|d| (*d).to_string()).collect(),
                    approval_timeout_s: 3_600,
                    budget: None,
                    deleted_at: None,
                })
                .expect("add");
        }
        Arc::new(Egress::open(home).expect("egress"))
    }

    /// Issue #43: the Unix socket answers with the same rules as the TCP port.
    /// A domain the Egress does not name gets no answer at all, whichever way
    /// the request arrived (ADR 0022, 0069).
    #[tokio::test]
    async fn a_request_on_the_unix_socket_is_checked_like_one_on_tcp() {
        let home = tempfile::tempdir().expect("home");
        let egress = egress_with(home.path(), &[("a1", &[])]);
        let socket = home.path().join("egress.sock");
        let proxy = start_with_socket(Arc::clone(&egress), "a1", &|_| false, Some(&socket))
            .await
            .expect("proxy");
        assert_eq!(proxy.socket.as_deref(), Some(socket.as_path()));

        let mut client = tokio::net::UnixStream::connect(&socket)
            .await
            .expect("connect the socket");
        client
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\n\r\n")
            .await
            .expect("write");
        let mut answer = [0u8; 16];
        // The empty Egress drops the connection instead of answering it.
        let read = client.read(&mut answer).await.expect("read");
        assert_eq!(read, 0);
    }

    /// Issue #43: a request that reaches one Agent's listener is judged by that
    /// Agent's list and no other. B's domain is dropped on A's proxy, and A's
    /// domain on B's, so neither can borrow the other's way out (ADR 0029).
    #[tokio::test]
    async fn one_agents_proxy_refuses_what_another_agents_egress_names() {
        let home = tempfile::tempdir().expect("home");
        let egress = egress_with(
            home.path(),
            &[("a1", &["a.example.com"]), ("a2", &["b.example.com"])],
        );
        assert_eq!(egress.current("a1"), vec!["a.example.com".to_string()]);
        assert_eq!(egress.current("a2"), vec!["b.example.com".to_string()]);

        let proxy = start(Arc::clone(&egress), "a1").await.expect("proxy a1");
        let mut client = TcpStream::connect(("127.0.0.1", proxy.port))
            .await
            .expect("connect a1");
        client
            .write_all(b"CONNECT b.example.com:443 HTTP/1.1\r\n\r\n")
            .await
            .expect("write");
        let mut answer = [0u8; 16];
        let read = client.read(&mut answer).await.expect("read");
        assert_eq!(read, 0, "agent a1 used agent a2's Egress");

        let proxy = start(Arc::clone(&egress), "a2").await.expect("proxy a2");
        let mut client = TcpStream::connect(("127.0.0.1", proxy.port))
            .await
            .expect("connect a2");
        client
            .write_all(b"CONNECT a.example.com:443 HTTP/1.1\r\n\r\n")
            .await
            .expect("write");
        let mut answer = [0u8; 16];
        let read = client.read(&mut answer).await.expect("read");
        assert_eq!(read, 0, "agent a2 used agent a1's Egress");
    }

    /// Issue #43: each Agent gets its own listener, kept while it asks for it.
    #[tokio::test]
    async fn every_agent_gets_its_own_listener() {
        let home = tempfile::tempdir().expect("home");
        let egress = egress_with(home.path(), &[("a1", &[]), ("a2", &[])]);
        let proxies = Proxies::new(home.path().to_path_buf(), egress);
        let one = proxies.ensure("a1").await.expect("a1");
        let two = proxies.ensure("a2").await.expect("a2");
        assert_ne!(one.port, two.port);
        assert_eq!(proxies.ensure("a1").await.expect("again"), one);
        assert_eq!(proxies.get("a1"), Some(one.clone()));
        assert_eq!(proxies.ports().len(), 2);

        proxies.stop("a1");
        assert_eq!(proxies.get("a1"), None);
        assert_eq!(proxies.get("a2"), Some(two));
    }
}
