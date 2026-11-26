//! The worker's half of Linux egress (ADR 0069): a TCP listener on the
//! namespace's own loopback that forwards to the supervisor's proxy socket.
//!
//! The supervisor is outside the network namespace and only its Unix socket is
//! bound in, so a command cannot be handed an `HTTP_PROXY` that answers. The
//! bridge closes that gap with what the namespace already has: `127.0.0.1`,
//! the port of a listener the worker owns, and the one bound socket. Every
//! byte then takes the same path as on macOS — the command speaks ordinary
//! HTTP to a loopback port, and the proxy is what checks the Egress.
//!
//! There is no `socat` here on purpose: a second binary in the sandbox is
//! another thing to install, another argv to profile, and one more process
//! holding the only way out.

use std::path::Path;

use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, UnixStream};

/// A running bridge: the URL a command's `HTTP_PROXY` points at.
pub struct Bridge {
    /// `http://127.0.0.1:<port>`, inside the worker's namespace.
    pub url: String,
}

/// Listens on a free loopback port and forwards every connection to the
/// proxy's Unix socket.
///
/// The socket is opened once before this returns: a bridge that cannot connect
/// is a worker with no way out, and saying so now is better than a worker that
/// looks ready and refuses every network tool of the Turn.
pub async fn start(socket: &Path) -> std::io::Result<Bridge> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    // Proves the socket is there and answering. The connection is dropped at
    // once; the proxy sees a client that said nothing and closes it.
    UnixStream::connect(socket).await?;
    let socket = socket.to_path_buf();
    tokio::spawn(async move {
        loop {
            let Ok((mut client, _)) = listener.accept().await else {
                break;
            };
            let socket = socket.clone();
            tokio::spawn(async move {
                // A proxy that refuses a host closes without an answer; that is
                // its refusal, and it ends here too.
                let Ok(mut upstream) = UnixStream::connect(&socket).await else {
                    return;
                };
                let _ = copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    });
    Ok(Bridge {
        url: format!("http://127.0.0.1:{port}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    /// A stand-in proxy: accepts every connection and sends back what it got.
    fn echo_at(path: &Path) -> tokio::task::JoinHandle<()> {
        let listener = tokio::net::UnixListener::bind(path).expect("bind the stand-in proxy");
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let (mut reading, mut writing) = tokio::io::split(stream);
                tokio::spawn(async move {
                    let mut buffer = [0u8; 1024];
                    while let Ok(read) = reading.read(&mut buffer).await {
                        if read == 0 || writing.write_all(&buffer[..read]).await.is_err() {
                            return;
                        }
                    }
                });
            }
        })
    }

    /// The command side: what a `curl` with `HTTP_PROXY` does, on loopback.
    #[tokio::test]
    async fn bytes_round_trip_through_the_listener_and_the_unix_socket() {
        let dir = tempfile::tempdir().expect("dir");
        let socket = dir.path().join("egress.sock");
        let echo = echo_at(&socket);
        let bridge = start(&socket).await.expect("bridge");

        let request = b"CONNECT example.com:443 HTTP/1.1\r\n\r\n";
        let port = bridge.url.trim_start_matches("http://");
        let mut client = TcpStream::connect(port).await.expect("connect the bridge");
        client.write_all(request).await.expect("write");
        let mut answer = vec![0u8; request.len()];
        client.read_exact(&mut answer).await.expect("read");
        assert_eq!(answer, request);

        drop(client);
        echo.abort();
    }

    /// A socket nobody listens on is a failure to start, not a worker that runs
    /// without a way out and finds out at the first Turn.
    #[tokio::test]
    async fn a_socket_that_does_not_answer_stops_the_bridge() {
        let dir = tempfile::tempdir().expect("dir");
        let error = start(&dir.path().join("missing.sock"))
            .await
            .err()
            .expect("the bridge started with no socket");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound, "{error}");
    }
}
