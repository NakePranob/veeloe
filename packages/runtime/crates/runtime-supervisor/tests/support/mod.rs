//! A real Hub for the supervisor's tests: `hub/cmd/testhub`, built once and
//! started per test. Nothing here stands in for the Hub's own handshake.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// The real relay, built once and started per test.
pub struct TestHub {
    child: Child,
    pub url: String,
}

impl TestHub {
    pub fn start() -> Self {
        let binary = binary();
        let mut child = Command::new(binary)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start the test hub");
        let mut line = String::new();
        BufReader::new(child.stdout.take().expect("stdout"))
            .read_line(&mut line)
            .expect("the hub prints its url");
        Self {
            child,
            url: line.trim().to_string(),
        }
    }
}

impl Drop for TestHub {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A Provider that lists its models over real HTTP, so `provider add` is
/// checked the way an operator's own Provider would be. A key of `wrong` is
/// refused with 401, as a real Provider would.
pub struct ModelsStub {
    shutdown: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
    pub url: String,
}

impl ModelsStub {
    pub fn start() -> Self {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a stub Provider");
        listener
            .set_nonblocking(true)
            .expect("non-blocking accept");
        let url = format!("http://{}", listener.local_addr().expect("address"));
        let shutdown = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&shutdown);
        let join = std::thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        // A request head can arrive in more than one read, and the
                        // key is not always in the first one: read until the head
                        // ends, or the stub answers a request it never saw.
                        let mut request = Vec::new();
                        let mut buffer = [0u8; 4096];
                        let deadline = Instant::now() + Duration::from_secs(2);
                        while !request.windows(4).any(|window| window == b"\r\n\r\n")
                            && Instant::now() < deadline
                        {
                            match socket.read(&mut buffer) {
                                Ok(0) => break,
                                Ok(read) => request.extend_from_slice(&buffer[..read]),
                                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(Duration::from_millis(5));
                                }
                                Err(_) => break,
                            }
                        }
                        let request = String::from_utf8_lossy(&request).to_lowercase();
                        let refused = request.contains("x-api-key: wrong")
                            || request.contains("authorization: bearer wrong");
                        let (status, body) = if refused {
                            ("401 Unauthorized", String::new())
                        } else {
                            (
                                "200 OK",
                                "{\"data\":[{\"id\":\"model-a\",\"display_name\":\"Model A\"},{\"id\":\"model-b\"}],\"has_more\":false}"
                                    .to_string(),
                            )
                        };
                        let response = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = socket.write_all(response.as_bytes());
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            shutdown,
            join: Some(join),
            url,
        }
    }
}

impl Drop for ModelsStub {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn binary() -> PathBuf {
    static BINARY: OnceLock<PathBuf> = OnceLock::new();
    BINARY
        .get_or_init(|| {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            // crates/runtime-supervisor → crates → runtime → packages → the repo.
            let hub = root.join("../../../../hub");
            assert!(hub.is_dir(), "the Hub is not at {}", hub.display());
            let out = std::env::temp_dir().join(format!("veeloe-testhub-{}", std::process::id()));
            let build = Command::new("go")
                .args(["build", "-o"])
                .arg(&out)
                .arg("./cmd/testhub")
                .current_dir(&hub)
                .output()
                .expect("go build");
            assert!(
                build.status.success(),
                "could not build the Hub: {}",
                String::from_utf8_lossy(&build.stderr)
            );
            out
        })
        .clone()
}

pub async fn until(condition: impl Fn() -> bool, millis: u64) -> bool {
    let end = Instant::now() + Duration::from_millis(millis);
    while Instant::now() < end {
        if condition() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    condition()
}

/// The `veeloe` binary Cargo built for this test, in the hidden mode that turns
/// it into a worker (ADR 0020). Cargo names the file itself, so where a runner
/// keeps its target folder is not the test's business.
pub fn worker_binary() -> Vec<String> {
    vec![env!("CARGO_BIN_EXE_veeloe").to_string(), "worker".to_string()]
}

