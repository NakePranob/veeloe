//! The first run: `veeloe` with nothing set up. A person at a terminal is asked
//! for the Hub URL, the Machine pairs, a Provider is added, and only then does
//! the Supervisor start (legacy `firstRun`, `supervisor/index.ts:213-245`).
//!
//! The terminal is a real one: the binary is started under `script`, which gives
//! it a pty, so `stdin().is_terminal()` is true exactly as it is for an operator.
//! The Hub is the real Go relay, and the Controller that claims the link signs
//! the way the app does.

mod support;

use std::fs;
use std::io::{BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use support::{until, ModelsStub, TestHub};
use tempfile::tempdir;
use tokio_tungstenite::tungstenite::Message;
use veeloe_protocol::base64url::to_base64url;
use veeloe_protocol::crypto::public_key_of;
use veeloe_protocol::frame::{parse_frame, Frame};
use veeloe_protocol::hub_auth::answer_challenge;
use veeloe_protocol::pairing::{pairing_proof, parse_pairing_link};
use veeloe_protocol::signer::{Outgoing, Signer};

/// The keys `cmd/testhub` knows: TEST-ONLY fixed seeds, the ones e2e uses.
const MACHINE_SEED: [u8; 32] = [0x33; 32];
const CONTROLLER_SEED: [u8; 32] = [0x44; 32];

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn write_machine_key(home: &Path) {
    let file = home.join("machine.key");
    fs::write(&file, MACHINE_SEED).expect("machine key");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).expect("mode");
}

/// The binary under a pty, its output collected as it is written.
struct Terminal {
    child: Child,
    input: ChildStdin,
    lines: Arc<Mutex<Vec<String>>>,
    /// What has been written since the last newline: a prompt ends with no
    /// newline, and the terminal must still be seen saying it.
    pending: Arc<Mutex<String>>,
}

impl Terminal {
    fn start(home: &Path) -> Self {
        let binary = env!("CARGO_BIN_EXE_veeloe");
        let mut pty = Command::new("script");
        // BSD `script` (macOS) takes the command as trailing arguments and
        // returns its status; GNU `script` (Linux) takes the command after `-c`
        // and needs `-e` to return that status instead of its own.
        if cfg!(target_os = "linux") {
            pty.args(["-q", "-e", "-c", binary, "/dev/null"]);
        } else {
            pty.args(["-q", "/dev/null", binary]);
        }
        let mut child = pty
            .env("VEELOE_HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start veeloe under a pty");
        let input = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let pending: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let recorded = Arc::clone(&lines);
        let fragment = Arc::clone(&pending);
        std::thread::spawn(move || {
            use std::io::Read;
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 512];
            loop {
                let Ok(read) = reader.read(&mut buffer) else { break };
                if read == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                for (at, part) in text.split('\n').enumerate() {
                    if at > 0 {
                        let mut held = fragment.lock().expect("pending");
                        recorded.lock().expect("lines").push(std::mem::take(&mut *held));
                    }
                    fragment.lock().expect("pending").push_str(part);
                }
            }
        });
        Self {
            child,
            input,
            lines,
            pending,
        }
    }

    fn answer(&mut self, answer: &str) {
        writeln!(self.input, "{answer}").expect("answer the terminal");
        self.input.flush().expect("flush");
    }

    /// One key, no Enter: what an arrow pick takes.
    fn send(&mut self, keys: &str) {
        self.input.write_all(keys.as_bytes()).expect("send to the terminal");
        self.input.flush().expect("flush");
    }

    fn seen(&self, needle: &str) -> Option<String> {
        if let Some(line) = self
            .lines
            .lock()
            .expect("lines")
            .iter()
            .rev()
            .find(|line| line.contains(needle))
        {
            return Some(line.clone());
        }
        let pending = self.pending.lock().expect("pending");
        pending.contains(needle).then(|| pending.clone())
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Controller {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
}

impl Controller {
    async fn connect(hub_url: &str) -> Self {
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("{hub_url}/connect"))
            .await
            .expect("controller connects");
        let challenge = next_frame(&mut socket).await;
        let Frame::Known { type_, value } = parse_frame(&challenge) else {
            panic!("no challenge: {challenge}");
        };
        assert_eq!(type_, "hub.challenge");
        let nonce = value["nonce"].as_str().expect("nonce");
        let answer = answer_challenge(hub_url, nonce, &CONTROLLER_SEED).expect("answer");
        socket
            .send(Message::Text(answer.to_string().into()))
            .await
            .expect("answer the challenge");
        let ready = next_frame(&mut socket).await;
        let Frame::Known { type_, value } = parse_frame(&ready) else {
            panic!("not ready: {ready}");
        };
        assert_eq!(type_, "hub.ready");
        assert_eq!(value["member"], "member-1");
        Self { socket }
    }

    async fn send(&mut self, value: Value) {
        self.socket
            .send(Message::Text(value.to_string().into()))
            .await
            .expect("send");
    }

    async fn next(&mut self) -> Value {
        serde_json::from_str(&next_frame(&mut self.socket).await).expect("json")
    }
}

async fn next_frame(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> String {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => return text.to_string(),
            Some(Ok(_)) => continue,
            other => panic!("no frame: {other:?}"),
        }
    }
}

/// The whole first run, from an empty folder to a running Supervisor.
#[tokio::test]
async fn an_unpaired_machine_is_asked_for_its_hub_pairs_offers_a_provider_and_then_starts() {
    let hub = TestHub::start();
    let home = tempdir().expect("home");
    // The key the test Hub knows, so this test can work the Controller's side.
    write_machine_key(home.path());
    let mut terminal = Terminal::start(home.path());

    // 1. It asks, because nothing knows the Hub yet.
    assert!(
        until(|| terminal.seen("Hub URL (wss://... from the Veeloe app):").is_some(), 10_000).await,
        "no Hub URL prompt: {:?}",
        terminal.lines.lock().expect("lines")
    );
    terminal.answer(&hub.url);

    // 2. It says it is not paired, and shows a link the app can read.
    assert!(
        until(
            || terminal
                .seen("This Machine is not paired yet. Pair it with the Veeloe app first.")
                .is_some(),
            10_000
        )
        .await,
        "no pairing message: {:?}",
        terminal.lines.lock().expect("lines")
    );
    assert!(
        until(
            || terminal
                .lines
                .lock()
                .expect("lines")
                .iter()
                .any(|line| line.contains("veeloe://pair?")),
            15_000
        )
        .await,
        "no pairing link: {:?}",
        terminal.lines.lock().expect("lines")
    );
    let link = terminal
        .lines
        .lock()
        .expect("lines")
        .iter()
        .find_map(|line| line.split("veeloe://pair?").nth(1).map(|rest| format!("veeloe://pair?{rest}")))
        .expect("link");
    let link = link.split_whitespace().next().expect("link").to_string();
    let parsed = parse_pairing_link(&link, now_ms()).expect("a link the Machine signed");

    // 3. The Hub URL it asked for is on disk before anything else happens.
    let config: Value = serde_json::from_str(
        &fs::read_to_string(home.path().join("config.json")).expect("config"),
    )
    .expect("json");
    assert_eq!(config["hubUrl"], hub.url);

    // 4. The Controller claims the link, the way the app does after a scan.
    let mut controller = Controller::connect(&hub.url).await;
    let controller_key = to_base64url(&public_key_of(&CONTROLLER_SEED));
    let proof = pairing_proof(&parsed.secret, &parsed.machine, &controller_key, "member-1")
        .expect("proof");
    let claim = Signer::new(&CONTROLLER_SEED).sign(
        Outgoing {
            type_: "pairing.claim".into(),
            to: Some("machine-1".into()),
            recipients: None,
            task: None,
            member: None,
            body: json!({
                "member": "member-1",
                "proof": proof,
                "keys": [controller_key],
                "workspace": "w-1",
            }),
        },
        1,
    );
    controller.send(serde_json::to_value(claim).expect("claim")).await;
    let done = controller.next().await;
    assert_eq!(done["type"], "pairing.done");

    // 5. Trust is written, so the pairing survived the process.
    let trust: Value = serde_json::from_str(
        &fs::read_to_string(home.path().join("runtime/trust.json")).expect("trust"),
    )
    .expect("json");
    assert_eq!(trust["owners"][0]["member"], "member-1");

    // 6. With no Provider it offers one: the picker takes a number here, then
    // the custom path asks for a name, a URL and the key, as the legacy wizard did.
    let stub = ModelsStub::start();
    assert!(
        until(
            || terminal
                .seen("Next, add a Provider: the LLM your Agents use.")
                .is_some(),
            15_000
        )
        .await,
        "no Provider offer: {:?}",
        terminal.lines.lock().expect("lines")
    );
    assert!(
        until(
            || terminal
                .seen("Which Provider do you want to add?")
                .is_some(),
            15_000
        )
        .await,
        "no Provider pick: {:?}",
        terminal.lines.lock().expect("lines")
    );
    // 4 is "Custom (enter a URL)"; a pick is one keypress, no Enter.
    terminal.send("4");
    assert!(
        until(|| terminal.seen("Name for this Provider: ").is_some(), 15_000).await,
        "no name prompt: {:?}",
        terminal.lines.lock().expect("lines")
    );
    terminal.answer("local");
    assert!(
        until(
            || terminal
                .seen("Base URL (such as https://api.anthropic.com): ")
                .is_some(),
            15_000
        )
        .await,
        "no URL prompt: {:?}",
        terminal.lines.lock().expect("lines")
    );
    terminal.answer(&stub.url);
    assert!(
        until(|| terminal.seen("Provider key: ").is_some(), 15_000).await,
        "no key prompt: {:?}",
        terminal.lines.lock().expect("lines")
    );
    terminal.answer("sk-test-only");

    // 7. The Provider is written, and the Supervisor starts with it.
    assert!(
        until(
            || home
                .path()
                .join("runtime/providers.json")
                .exists(),
            15_000
        )
        .await,
        "no providers.json: {:?}",
        terminal.lines.lock().expect("lines")
    );
    let providers: Value = serde_json::from_str(
        &fs::read_to_string(home.path().join("runtime/providers.json")).expect("providers"),
    )
    .expect("json");
    assert_eq!(providers[0]["name"], "local");
    assert_eq!(providers[0]["url"], stub.url);
    // The auth was detected by asking the Provider, not guessed.
    assert_eq!(providers[0]["auth"], "x-api-key");
    // The key is in the file, never on the terminal.
    assert_eq!(providers[0]["key"], "sk-test-only");
    assert!(
        !terminal.lines.lock().expect("lines").iter().any(|line| line.contains("sk-test-only")),
        "the key was echoed: {:?}",
        terminal.lines.lock().expect("lines")
    );

    assert!(
        until(
            || terminal
                .lines
                .lock()
                .expect("lines")
                .iter()
                .any(|line| line.contains("connected as machine")),
            30_000
        )
        .await,
        "the Supervisor did not start: {:?}",
        terminal.lines.lock().expect("lines")
    );
    assert!(
        !terminal
            .lines
            .lock()
            .expect("lines")
            .iter()
            .any(|line| line.contains("not paired today")),
        "a first run asked nothing: {:?}",
        terminal.lines.lock().expect("lines")
    );
}

/// Without a terminal nothing is asked and nothing is written: the three
/// commands are named instead (legacy `firstRun`'s `!interactive()` branch).
#[test]
fn without_a_terminal_the_first_run_names_the_commands_and_writes_nothing() {
    let home = tempdir().expect("home");
    let empty = home.path().join("empty");
    fs::create_dir_all(&empty).expect("empty");

    let output = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .env("VEELOE_HOME", &empty)
        .stdin(Stdio::null())
        .output()
        .expect("run veeloe");
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    // With no Hub URL, that is the first thing to say.
    assert!(stderr.contains("no Hub URL"), "{stderr}");
    assert!(!empty.join("config.json").exists());

    fs::write(empty.join("config.json"), json!({ "hubUrl": "wss://hub.test" }).to_string())
        .expect("config");
    let output = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .env("VEELOE_HOME", &empty)
        .stdin(Stdio::null())
        .output()
        .expect("run veeloe");
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("this Machine is not paired yet"), "{stderr}");
    assert!(stderr.contains("veeloe pair"), "{stderr}");
    assert!(stderr.contains("veeloe provider add"), "{stderr}");
    assert!(!empty.join("runtime/trust.json").exists());
    assert!(!empty.join("runtime/providers.json").exists());
}

/// A person who says nothing but a bad Hub URL is told so, and nothing is
/// written: the prompt comes back rather than a crash or a silent exit.
#[tokio::test]
async fn a_hub_url_that_is_not_a_websocket_url_is_refused() {
    let home = tempdir().expect("home");
    let mut terminal = Terminal::start(home.path());
    assert!(
        until(|| terminal.seen("Hub URL (wss://... from the Veeloe app):").is_some(), 10_000).await
    );
    terminal.answer("not a url");
    let exit = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(status) = terminal.child.try_wait().expect("wait") {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the command ends");
    assert!(!exit.success());
    assert!(!home.path().join("config.json").exists());
    let started = Instant::now();
    assert!(started.elapsed() < Duration::from_secs(20));
    let _ = PathBuf::new();
}
