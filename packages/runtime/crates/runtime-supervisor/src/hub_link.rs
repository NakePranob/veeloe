//! The Machine's connection to its Hub, ported from
//! `packages/runtime-legacy/src/supervisor/hub-link/hub-link.ts`.
//!
//! It answers the Hub's challenge with the Machine key, reports what the Hub
//! says, and reconnects with backoff whenever the connection drops or cannot be
//! opened. Runs until stopped.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use veeloe_protocol::backoff::Backoff;
use veeloe_protocol::frame::{parse_frame, Frame};
use veeloe_protocol::hub_auth::answer_challenge;

/// The close codes the Hub uses to say why it would not keep a Machine.
const AUTH_FAILED: u16 = 4401;
const HANDSHAKE_TIMEOUT: u16 = 4402;
const REPLACED: u16 = 4403;
const REVOKED: u16 = 4404;

fn close_reason(code: u16) -> Option<&'static str> {
    match code {
        AUTH_FAILED => Some("the Hub does not know this Machine's key, or the answer did not check out"),
        HANDSHAKE_TIMEOUT => Some("the handshake took too long"),
        REPLACED => Some("another connection with this Machine's key took over"),
        REVOKED => Some("the Hub says this key was revoked"),
        _ => None,
    }
}

/// What the Runtime hears from its Hub.
pub trait HubLinkSink: Send + Sync {
    fn log(&self, line: &str);
    /// The Hub accepted the key and named this Machine.
    fn on_ready(&self, machine: &str);
    /// A frame that is not the Hub's own: an envelope, unverified. `send` writes
    /// back on the same connection.
    fn on_envelope(&self, value: Value, send: &HubSender);
    /// Certificates the Hub keeps for the Workspace, unverified. They come
    /// before any envelope.
    fn on_certificates(&self, certificates: Vec<Value>);
}

/// A sink that says nothing, for a link nobody is listening to.
pub struct Quiet;

impl HubLinkSink for Quiet {
    fn log(&self, _line: &str) {}
    fn on_ready(&self, _machine: &str) {}
    fn on_envelope(&self, _value: Value, _send: &HubSender) {}
    fn on_certificates(&self, _certificates: Vec<Value>) {}
}

#[derive(Debug, Clone)]
pub struct HubLinkOptions {
    pub hub_url: String,
    pub secret_key: [u8; 32],
    /// The first retry waits at most this long; every one after doubles it.
    pub base_ms: u64,
    pub cap_ms: u64,
}

impl HubLinkOptions {
    pub fn new(hub_url: impl Into<String>, secret_key: [u8; 32]) -> Self {
        Self {
            hub_url: hub_url.into(),
            secret_key,
            base_ms: 500,
            cap_ms: 30_000,
        }
    }
}

enum Command {
    Frame(Value),
    Stop,
}

/// The way back onto the connection, handed to whoever must answer the Hub.
#[derive(Clone)]
pub struct HubSender {
    commands: mpsc::UnboundedSender<Command>,
    connected: watch::Receiver<bool>,
}

impl HubSender {
    /// False while there is no accepted connection: the frame is not kept.
    pub fn send(&self, frame: Value) -> bool {
        if !*self.connected.borrow() {
            return false;
        }
        self.commands.send(Command::Frame(frame)).is_ok()
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.borrow()
    }
}

pub struct HubLink {
    sender: HubSender,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl HubLink {
    pub fn start(options: HubLinkOptions, sink: Arc<dyn HubLinkSink>) -> Self {
        let (commands, queue) = mpsc::unbounded_channel();
        let (connected, watching) = watch::channel(false);
        let sender = HubSender {
            commands,
            connected: watching,
        };
        let task = tokio::spawn(run(
            options,
            sink,
            queue,
            connected,
            sender.clone(),
        ));
        Self {
            sender,
            task: Mutex::new(Some(task)),
        }
    }

    /// False while there is no accepted connection: the frame is not kept.
    pub fn send(&self, frame: Value) -> bool {
        self.sender.send(frame)
    }

    pub fn is_connected(&self) -> bool {
        self.sender.is_connected()
    }

    /// Stops the link and waits for the socket to close.
    pub async fn stop(&self) {
        let _ = self.sender.commands.send(Command::Stop);
        let task = self.task.lock().expect("task").take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}

async fn run(
    options: HubLinkOptions,
    sink: Arc<dyn HubLinkSink>,
    mut commands: mpsc::UnboundedReceiver<Command>,
    connected: watch::Sender<bool>,
    sender: HubSender,
) {
    let url = format!("{}/connect", options.hub_url.trim_end_matches('/'));
    let mut backoff = Backoff::new(options.base_ms, options.cap_ms);
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((socket, _)) => {
                let ended = session(
                    socket,
                    &options,
                    Arc::clone(&sink),
                    &mut commands,
                    &connected,
                    &sender,
                )
                .await;
                let _ = connected.send(false);
                if ended.stop {
                    return;
                }
                let why = close_reason(ended.code).unwrap_or(if ended.ready {
                        "connection lost"
                    } else {
                        "could not connect"
                    });
                let delay = backoff.next_with(random());
                sink.log(&format!(
                    "hub {}: {why} ({}); retrying in {delay} ms",
                    if ended.ready {
                        "connection closed"
                    } else {
                        "rejected or unreachable"
                    },
                    ended.code
                ));
                if wait_or_stop(&mut commands, delay).await {
                    return;
                }
            }
            Err(_) => {
                let delay = backoff.next_with(random());
                sink.log(&format!(
                    "hub rejected or unreachable: could not connect (0); retrying in {delay} ms"
                ));
                if wait_or_stop(&mut commands, delay).await {
                    return;
                }
            }
        }
    }
}

struct Ended {
    ready: bool,
    code: u16,
    stop: bool,
}

async fn session(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    options: &HubLinkOptions,
    sink: Arc<dyn HubLinkSink>,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    connected: &watch::Sender<bool>,
    sender: &HubSender,
) -> Ended {
    let (mut writing, mut reading) = socket.split();
    let mut ready = false;
    let mut code = 0u16;
    let mut stop = false;
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::Frame(frame)) => {
                    let text = frame.to_string();
                    if writing.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Some(Command::Stop) | None => {
                    stop = true;
                    let _ = writing.send(Message::Close(None)).await;
                    break;
                }
            },
            incoming = reading.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Heard::Reply(reply) =
                        heard(&text, options, &sink, &mut ready, connected, sender)
                    {
                        let text = reply.to_string();
                        if writing.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    code = frame.map(|frame| u16::from(frame.code)).unwrap_or(0);
                    break;
                }
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => break,
            },
        }
    }
    Ended { ready, code, stop }
}

/// What one frame from the Hub asks for.
enum Heard {
    /// The challenge was answered and the answer must go out now.
    Reply(Value),
    Nothing,
    /// Not readable at all: skipped (ADR 0023).
    Unreadable,
}

/// Handles one frame from the Hub.
fn heard(
    text: &str,
    options: &HubLinkOptions,
    sink: &Arc<dyn HubLinkSink>,
    ready: &mut bool,
    connected: &watch::Sender<bool>,
    sender: &HubSender,
) -> Heard {
    match parse_frame(text) {
        Frame::Invalid => Heard::Unreadable,
        Frame::Unknown { .. } => {
            // A frame this build does not know is skipped, never a failure
            // (ADR 0023). Once ready it is an envelope for the Runtime.
            if *ready {
                if let Ok(value) = serde_json::from_str::<Value>(text) {
                    sink.on_envelope(value, sender);
                }
            }
            Heard::Nothing
        }
        Frame::Known { type_, value } => {
            match type_.as_str() {
                "hub.challenge" if !*ready => {
                    let nonce = value
                        .get("nonce")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    return match answer_challenge(&options.hub_url, nonce, &options.secret_key) {
                        Ok(answer) => Heard::Reply(answer),
                        Err(_) => Heard::Nothing,
                    };
                }
                "hub.ready" if !*ready => {
                    *ready = true;
                    let _ = connected.send(true);
                    match value.get("machine").and_then(Value::as_str) {
                        Some(machine) => {
                            sink.log(&format!(
                                "connected to hub {} as machine {machine}",
                                options.hub_url
                            ));
                            sink.on_ready(machine);
                        }
                        None => {
                            let member = value
                                .get("member")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            sink.log(&format!("connected to hub {} as {member}", options.hub_url));
                        }
                    }
                }
                "hub.certificates" if *ready => {
                    let certificates = value
                        .get("certificates")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    sink.on_certificates(certificates);
                }
                _ => {}
            }
            Heard::Nothing
        }
    }
}

/// Waits `delay`, unless a Stop arrives first. True when the link should end.
async fn wait_or_stop(commands: &mut mpsc::UnboundedReceiver<Command>, delay: u64) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(delay)) => false,
        command = commands.recv() => matches!(command, Some(Command::Stop) | None),
    }
}

/// A number in `[0, 1)`, so the backoff has jitter without pulling in a
/// random-number crate.
pub(crate) fn random() -> f64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos() as u64 ^ elapsed.as_secs())
        .unwrap_or_default();
    let mixed = nanos.wrapping_mul(6364136223846793005).wrapping_add(
        COUNTER
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_mul(1442695040888963407),
    );
    ((mixed >> 11) as f64) / ((1u64 << 53) as f64)
}
