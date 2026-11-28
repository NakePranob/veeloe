//! The direct link between a Controller and this Machine (ADR 0090): a WebRTC
//! DataChannel the Controller offers through the Hub. What runs on it are the
//! same signed envelopes the Hub carries, checked the same way, so the channel
//! itself is never what makes an envelope trusted (ADR 0006).
//!
//! The offer and the answer travel as signed envelopes (`link.offer`,
//! `link.answer`). The SDP in them holds each side's DTLS fingerprint, and DTLS
//! refuses a peer whose certificate does not match it, so a Hub that swaps
//! either side's SDP breaks the signature, and a Hub that keeps the SDP cannot
//! stand in for the peer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
    RTCIceGatheringState, RTCIceServer, RTCPeerConnectionState, RTCSessionDescription,
};
use webrtc::runtime::{channel, default_runtime, Runtime, Sender};

/// The biggest envelope sent on the direct link. A bigger one goes through the
/// Hub, which takes frames of any size it takes today (#95 moves big files here
/// in chunks).
pub const DIRECT_MAX_BYTES: usize = 64 * 1024;

/// How long gathering this side's addresses may take before the answer goes
/// out with what it has.
const GATHER_TIMEOUT: Duration = Duration::from_secs(5);

/// One envelope read from a direct link, unverified.
pub type OnFrame = Arc<dyn Fn(Value) + Send + Sync>;

struct Link {
    member: String,
    channel: Arc<dyn DataChannel>,
    connection: Arc<dyn PeerConnection>,
    /// Envelopes waiting to be written, in the order they were signed: one
    /// writer per link, so nothing overtakes on the way out.
    queue: tokio::sync::mpsc::UnboundedSender<String>,
}

type Links = Arc<Mutex<HashMap<String, Link>>>;

/// Every open direct link, by the Controller key that offered it.
#[derive(Clone)]
pub struct DirectLinks {
    links: Links,
    runtime: Arc<dyn Runtime>,
    /// The Hub's STUN address, so a Machine behind NAT offers the address the
    /// internet sees it at, not only its own.
    stun: Option<String>,
}

/// The STUN address of the Hub at `hub_url`: the Hub's own host, port 3478
/// (ADR 0090). None for a URL with no host.
pub fn stun_of(hub_url: &str) -> Option<String> {
    let rest = hub_url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let host = if authority.starts_with('[') {
        &authority[..=authority.find(']')?]
    } else {
        authority.split(':').next()?
    };
    (!host.is_empty()).then(|| format!("stun:{host}:3478"))
}

fn configuration(stun: &Option<String>) -> webrtc::peer_connection::RTCConfiguration {
    let servers = stun
        .iter()
        .map(|url| RTCIceServer {
            urls: vec![url.clone()],
            ..Default::default()
        })
        .collect();
    RTCConfigurationBuilder::new()
        .with_ice_servers(servers)
        .build()
}

#[derive(Debug, thiserror::Error)]
pub enum DirectError {
    #[error("no async runtime")]
    Runtime,
    #[error("webrtc: {0}")]
    WebRtc(String),
}

fn webrtc(error: impl std::fmt::Display) -> DirectError {
    DirectError::WebRtc(error.to_string())
}

impl DirectLinks {
    pub fn new(stun: Option<String>) -> Result<Self, DirectError> {
        Ok(Self {
            links: Arc::new(Mutex::new(HashMap::new())),
            runtime: default_runtime().ok_or(DirectError::Runtime)?,
            stun,
        })
    }

    /// Answers a `link.offer` the caller already verified as signed by `key`,
    /// a key of `member`. Frames read from the channel go to `on_frame`. A link
    /// this key had before is closed: one device holds one link.
    ///
    /// ponytail: STUN only, no TURN: two NATs that both pick a new port per
    /// peer (some mobile carriers) never meet, and those envelopes stay on the
    /// Hub, which is the fallback anyway.
    pub async fn answer(
        &self,
        key: &str,
        member: &str,
        offer: &str,
        on_frame: OnFrame,
    ) -> Result<String, DirectError> {
        self.close(key).await;
        let (gathered, mut gathering) = channel::<()>(1);
        let handler = Arc::new(Handler {
            key: key.to_string(),
            member: member.to_string(),
            links: self.links.clone(),
            runtime: self.runtime.clone(),
            on_frame,
            gathered,
            connection: Mutex::new(None),
        });
        let connection: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::new()
                .with_configuration(configuration(&self.stun))
                .with_handler(handler.clone())
                .with_runtime(self.runtime.clone())
                .with_udp_addrs(vec!["0.0.0.0:0"])
                .build()
                .await
                .map_err(webrtc)?,
        );
        *handler.connection.lock().expect("connection") = Some(connection.clone());
        let offer = RTCSessionDescription::offer(offer.to_string()).map_err(webrtc)?;
        connection
            .set_remote_description(offer)
            .await
            .map_err(webrtc)?;
        let answer = connection.create_answer(None).await.map_err(webrtc)?;
        connection
            .set_local_description(answer)
            .await
            .map_err(webrtc)?;
        let _ = tokio::time::timeout(GATHER_TIMEOUT, gathering.recv()).await;
        let local = connection
            .local_description()
            .await
            .ok_or_else(|| DirectError::WebRtc("no local description".into()))?;
        Ok(local.sdp)
    }

    /// Queues one envelope on `key`'s link. False when there is no open link
    /// or the envelope is too big for it: the caller sends it through the Hub.
    /// A link that drops with envelopes still queued loses them, as a dropped
    /// Hub connection does; the Controller syncs again when it is back.
    pub fn send(&self, key: &str, text: &str) -> bool {
        if text.len() > DIRECT_MAX_BYTES {
            return false;
        }
        let links = self.links.lock().expect("links");
        links
            .get(key)
            .is_some_and(|link| link.queue.send(text.to_string()).is_ok())
    }

    /// The Controller keys of `member` with an open link.
    pub fn keys_of(&self, member: &str) -> Vec<String> {
        self.links
            .lock()
            .expect("links")
            .iter()
            .filter(|(_, link)| link.member == member)
            .map(|(key, _)| key.clone())
            .collect()
    }

    /// The Controller said `direct.close`: nothing more is written on its link,
    /// so what follows goes through the Hub, and the link itself ends a moment
    /// later, once what was already on its way has arrived.
    pub fn release(&self, key: &str) {
        let link = self.links.lock().expect("links").remove(key);
        if let Some(link) = link {
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let _ = link.connection.close().await;
            });
        }
    }

    /// Ends `key`'s link, as when that key is revoked.
    pub async fn close(&self, key: &str) {
        let link = self.links.lock().expect("links").remove(key);
        if let Some(link) = link {
            let _ = link.connection.close().await;
        }
    }
}

struct Handler {
    key: String,
    member: String,
    links: Links,
    runtime: Arc<dyn Runtime>,
    on_frame: OnFrame,
    gathered: Sender<()>,
    connection: Mutex<Option<Arc<dyn PeerConnection>>>,
}

impl Handler {
    fn forget(links: &Links, key: &str, channel: &Arc<dyn DataChannel>) {
        let mut links = links.lock().expect("links");
        // Only this channel's own entry: a newer link of the same key stays.
        if links
            .get(key)
            .is_some_and(|link| Arc::ptr_eq(&link.channel, channel))
        {
            links.remove(key);
        }
    }
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gathered.try_send(());
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        if matches!(
            state,
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
        ) {
            let mut links = self.links.lock().expect("links");
            let mine = self.connection.lock().expect("connection").clone();
            if let (Some(link), Some(mine)) = (links.get(&self.key), mine) {
                if Arc::ptr_eq(&link.connection, &mine) {
                    links.remove(&self.key);
                }
            }
        }
    }

    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        let key = self.key.clone();
        let member = self.member.clone();
        let links = self.links.clone();
        let on_frame = self.on_frame.clone();
        let Some(connection) = self.connection.lock().expect("connection").clone() else {
            return;
        };
        self.runtime.spawn(Box::pin(async move {
            while let Some(event) = channel.poll().await {
                match event {
                    DataChannelEvent::OnOpen => {
                        let (queue, mut waiting) = tokio::sync::mpsc::unbounded_channel::<String>();
                        let writer = channel.clone();
                        tokio::spawn(async move {
                            while let Some(text) = waiting.recv().await {
                                if writer.send_text(&text).await.is_err() {
                                    break;
                                }
                            }
                        });
                        links.lock().expect("links").insert(
                            key.clone(),
                            Link {
                                member: member.clone(),
                                channel: channel.clone(),
                                connection: connection.clone(),
                                queue,
                            },
                        );
                    }
                    DataChannelEvent::OnMessage(message) => {
                        if let Ok(value) = serde_json::from_slice::<Value>(&message.data) {
                            on_frame(value);
                        }
                    }
                    DataChannelEvent::OnClose => break,
                    _ => {}
                }
            }
            Handler::forget(&links, &key, &channel);
        }));
    }
}

/// Above this a file goes only on the direct link of the device that asked,
/// never through the Hub (ADR 0090).
pub const DIRECT_ONLY_BYTES: usize = 1024 * 1024;
/// A chunk small enough for the direct link once it is base64url and signed.
pub const DIRECT_CHUNK_BYTES: usize = 32 * 1024;

/// The chunk size a file of `len` bytes goes out in through the outbox, or
/// None when it must go on a direct link instead.
pub fn download_chunk(len: usize) -> Option<usize> {
    (len <= DIRECT_ONLY_BYTES).then_some(256 * 1024)
}

/// Whether an envelope for a Member must also go through the Hub: when any of
/// that Member's devices has no open link, or the Machine knows none of them.
/// A device that gets it both ways takes it once (ADR 0090's window).
pub fn hub_too(open: &[String], devices: &[String]) -> bool {
    devices.is_empty() || devices.iter().any(|device| !open.contains(device))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_file_over_a_megabyte_goes_only_on_a_direct_link() {
        assert_eq!(
            super::download_chunk(super::DIRECT_ONLY_BYTES),
            Some(256 * 1024)
        );
        assert_eq!(super::download_chunk(super::DIRECT_ONLY_BYTES + 1), None);
        // A direct chunk, base64url and inside a signed envelope, still fits the link.
        let encoded = super::DIRECT_CHUNK_BYTES.div_ceil(3) * 4;
        assert!(encoded + 2_000 < super::DIRECT_MAX_BYTES);
    }

    #[test]
    fn stun_is_the_hubs_own_host_on_3478() {
        assert_eq!(
            super::stun_of("wss://hub.example.com").as_deref(),
            Some("stun:hub.example.com:3478")
        );
        assert_eq!(
            super::stun_of("ws://127.0.0.1:8080/ws?x=1").as_deref(),
            Some("stun:127.0.0.1:3478")
        );
        assert_eq!(
            super::stun_of("wss://[2001:db8::1]:443").as_deref(),
            Some("stun:[2001:db8::1]:3478")
        );
        assert_eq!(super::stun_of("hub.example.com"), None);
        assert_eq!(super::stun_of("wss://"), None);
    }

    #[test]
    fn the_hub_is_skipped_only_when_every_device_is_direct() {
        let keys = |keys: &[&str]| keys.iter().map(|key| key.to_string()).collect::<Vec<_>>();
        assert!(!super::hub_too(&keys(&["a", "b"]), &keys(&["a", "b"])));
        assert!(super::hub_too(&keys(&["a"]), &keys(&["a", "b"])));
        assert!(super::hub_too(&keys(&[]), &keys(&["a"])));
        assert!(super::hub_too(&keys(&["a"]), &keys(&[])));
    }

    use super::*;

    struct Offerer {
        gathered: Sender<()>,
    }

    #[async_trait::async_trait]
    impl PeerConnectionEventHandler for Offerer {
        async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
            if state == RTCIceGatheringState::Complete {
                let _ = self.gathered.try_send(());
            }
        }
    }

    /// A Controller stand-in: offers one channel and returns it with its SDP.
    async fn offer() -> (Arc<dyn PeerConnection>, Arc<dyn DataChannel>, String) {
        let runtime = default_runtime().expect("runtime");
        let (gathered, mut gathering) = channel::<()>(1);
        let connection: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::new()
                .with_configuration(RTCConfigurationBuilder::new().build())
                .with_handler(Arc::new(Offerer { gathered }))
                .with_runtime(runtime)
                .with_udp_addrs(vec!["0.0.0.0:0"])
                .build()
                .await
                .expect("build"),
        );
        let data = connection
            .create_data_channel("veeloe", None)
            .await
            .expect("channel");
        let offer = connection.create_offer(None).await.expect("offer");
        connection
            .set_local_description(offer)
            .await
            .expect("local");
        let _ = tokio::time::timeout(GATHER_TIMEOUT, gathering.recv()).await;
        let sdp = connection.local_description().await.expect("sdp").sdp;
        (connection, data, sdp)
    }

    async fn opened(data: &Arc<dyn DataChannel>) {
        loop {
            match tokio::time::timeout(Duration::from_secs(10), data.poll()).await {
                Ok(Some(DataChannelEvent::OnOpen)) => return,
                Ok(Some(_)) => continue,
                other => panic!("channel did not open: {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn an_envelope_crosses_the_direct_link_both_ways() {
        let links = DirectLinks::new(None).expect("links");
        let (heard, mut hearing) = tokio::sync::mpsc::unbounded_channel();
        let (connection, data, sdp) = offer().await;
        let answer = links
            .answer(
                "key-1",
                "m_owner",
                &sdp,
                Arc::new(move |value| {
                    let _ = heard.send(value);
                }),
            )
            .await
            .expect("answer");
        connection
            .set_remote_description(RTCSessionDescription::answer(answer).expect("answer"))
            .await
            .expect("remote");
        opened(&data).await;

        data.send_text(r#"{"type":"task.message"}"#)
            .await
            .expect("send");
        let value = tokio::time::timeout(Duration::from_secs(10), hearing.recv())
            .await
            .expect("heard")
            .expect("frame");
        assert_eq!(value["type"], "task.message");

        // The Machine's side is open once the first frame is through.
        assert_eq!(links.keys_of("m_owner"), vec!["key-1".to_string()]);
        assert!(links.keys_of("m_other").is_empty());
        assert!(links.send("key-1", r#"{"type":"agent.listed"}"#));
        let back = loop {
            match tokio::time::timeout(Duration::from_secs(10), data.poll()).await {
                Ok(Some(DataChannelEvent::OnMessage(message))) => break message,
                Ok(Some(_)) => continue,
                other => panic!("no frame back: {other:?}"),
            }
        };
        assert_eq!(&back.data[..], br#"{"type":"agent.listed"}"#);

        // Too big for the link, or no link at all: the caller uses the Hub.
        assert!(!links.send("key-1", &"x".repeat(DIRECT_MAX_BYTES + 1)));
        assert!(!links.send("key-2", "{}"));

        links.close("key-1").await;
        assert!(links.keys_of("m_owner").is_empty());
        let _ = connection.close().await;
    }

    #[tokio::test]
    async fn an_offer_that_is_not_sdp_is_refused() {
        let links = DirectLinks::new(None).expect("links");
        let refused = links
            .answer("key-1", "m_owner", "not sdp", Arc::new(|_| {}))
            .await;
        assert!(refused.is_err());
        assert!(links.keys_of("m_owner").is_empty());
    }
}
