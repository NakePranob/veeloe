//! The local proxy every sandboxed command reaches the network through
//! (ADR 0008, 0029).
//!
//! Seatbelt cannot match a domain, and a list the kernel cannot check is not a
//! rule. So the sandbox allows exactly one outbound address, this proxy on
//! localhost, and the proxy decides per connection whether the Machine's
//! Egress lets the host out. It is read on every connection, so `egress.set`
//! takes effect without starting a worker again.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};

use crate::egress::Egress;

/// The largest request head a client may send before the proxy gives up.
const MAX_HEAD: usize = 16 * 1024;

/// A running proxy: the URL commands get, and the port the sandbox allows.
pub struct Proxy {
    pub url: String,
    pub port: u16,
}

/// Starts the proxy on a free loopback port. It runs until the process ends.
pub async fn start(egress: Arc<Egress>) -> std::io::Result<Proxy> {
    start_avoiding(egress, &|_| false).await
}

/// Starts the proxy on a free loopback port that `avoid` accepts. The Agent
/// ranges are reserved before the proxy opens, and a port inside a range is a
/// port a command may bind, so the proxy steps out of their way instead of
/// taking one that was already given away (ADR 0069).
pub async fn start_avoiding(
    egress: Arc<Egress>,
    avoid: &(dyn Fn(u16) -> bool + Send + Sync),
) -> std::io::Result<Proxy> {
    for _ in 0..16 {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        if avoid(port) {
            // Dropping the listener closes it, so the next try binds anew.
            drop(listener);
            continue;
        }
        tokio::spawn(async move {
            loop {
                let Ok((client, _)) = listener.accept().await else {
                    break;
                };
                let egress = Arc::clone(&egress);
                tokio::spawn(async move {
                    let _ = serve(client, egress).await;
                });
            }
        });
        return Ok(Proxy {
            url: format!("http://127.0.0.1:{port}"),
            port,
        });
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AddrNotAvailable,
        "no free loopback port outside the Agents' ranges",
    ))
}

/// One client: read its CONNECT, check the host, then copy bytes both ways.
async fn serve(mut client: TcpStream, egress: Arc<Egress>) -> std::io::Result<()> {
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
    if !allowed(&host, &egress.current()) {
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
}
