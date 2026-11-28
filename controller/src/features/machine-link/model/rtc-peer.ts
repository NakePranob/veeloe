import { RTCPeerConnection } from "react-native-webrtc";
import { type Channel, type Peer, stunOf } from "./direct";

/**
 * A react-native-webrtc peer for a direct link (ADR 0090): a data channel only, so the app asks
 * for no camera or microphone. The Hub at `hubUrl` answers STUN, so a phone behind NAT offers the
 * address the internet sees it at too.
 */
export function rtcPeer(hubUrl: string): Peer {
  const stun = stunOf(hubUrl);
  const connection = new RTCPeerConnection({ iceServers: stun ? [{ urls: stun }] : [] });
  return {
    get iceGatheringState() {
      return connection.iceGatheringState;
    },
    get connectionState() {
      return connection.connectionState;
    },
    get localDescription() {
      const sdp = connection.localDescription?.sdp;
      return sdp ? { sdp } : null;
    },
    createDataChannel(label) {
      const channel = connection.createDataChannel(label, { ordered: true });
      const wrapped: Channel = {
        get readyState() {
          return channel.readyState;
        },
        send: (text) => channel.send(text),
        close: () => channel.close(),
        addEventListener: (type, listener) => {
          if (type === "message") channel.addEventListener("message", (event) => listener({ data: event.data }));
          else channel.addEventListener(type, () => listener({}));
        },
      };
      return wrapped;
    },
    createOffer: async () => {
      const offer: { type?: unknown; sdp?: unknown } = await connection.createOffer({});
      return { type: String(offer.type ?? "offer"), sdp: typeof offer.sdp === "string" ? offer.sdp : undefined };
    },
    setLocalDescription: (description) => connection.setLocalDescription({ type: description.type === "offer" ? "offer" : "answer", sdp: description.sdp ?? "" }),
    setRemoteDescription: (description) => connection.setRemoteDescription(description),
    addEventListener: (type, listener) => connection.addEventListener(type, () => listener()),
    close: () => connection.close(),
  };
}
