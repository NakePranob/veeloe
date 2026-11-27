/**
 * The direct link to one Machine (ADR 0090): this device offers a WebRTC DataChannel through the
 * Hub (`direct.offer`), the Machine answers (`direct.answer`), and once the channel is open the
 * same signed envelopes go on it instead of the Hub. The SDP holds this device's DTLS fingerprint
 * and travels signed, so a Hub that swaps it breaks the signature.
 *
 * The peer is handed in, so this runs on react-native-webrtc in the app and on a fake in tests.
 */

/** The largest envelope sent on the link; a bigger one goes through the Hub, as on the Machine. */
export const DIRECT_MAX_BYTES = 64 * 1024;
const GATHER_TIMEOUT_MS = 5000;
const encoder = new TextEncoder();

type Listener = (event: { data?: unknown }) => void;

export interface Channel {
  readyState: string;
  send(text: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close", listener: Listener): void;
}

export interface Peer {
  iceGatheringState: string;
  connectionState: string;
  localDescription: { sdp: string } | null;
  createDataChannel(label: string): Channel;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(description: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void>;
  addEventListener(type: "icegatheringstatechange" | "connectionstatechange", listener: () => void): void;
  close(): void;
}

export type DirectLink = {
  /** The offer's id, which `direct.answer` and `direct.close` name. */
  id: string;
  /** The Machine's answer; one for another offer is ignored. */
  answer(id: string, sdp: string): void;
  /**
   * Ends the link. With `drainMs`, nothing more is written but what the Machine already sent is
   * still read for that long: the caller sends `direct.close` on the link just before.
   */
  close(drainMs?: number): void;
};

/**
 * Offers a link and reports it: `onOpen` with the way to write on it, `onClose` once it is gone or
 * never came up. `send` returns false when the envelope must go through the Hub instead.
 */
export function openDirect({
  createPeer,
  newId,
  offer,
  onOpen,
  onClose,
  onFrame,
}: {
  createPeer: () => Peer;
  newId: () => string;
  offer: (body: { id: string; sdp: string }) => void;
  onOpen: (send: (text: string) => boolean) => void;
  onClose: () => void;
  onFrame: (text: string) => void;
}): DirectLink {
  const id = newId();
  const peer = createPeer();
  const channel = peer.createDataChannel("veeloe");
  let closed = false;
  let draining = false;

  const end = () => {
    if (closed) return;
    closed = true;
    channel.close();
    peer.close();
    onClose();
  };

  channel.addEventListener("open", () => {
    onOpen((text) => {
      if (closed || draining || channel.readyState !== "open" || encoder.encode(text).length > DIRECT_MAX_BYTES) return false;
      channel.send(text);
      return true;
    });
  });
  channel.addEventListener("message", (event) => onFrame(String(event.data)));
  channel.addEventListener("close", end);
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") end();
  });

  // Every address goes in the one offer, so no candidate has to follow it through the Hub.
  const gathered = new Promise<void>((resolve) => {
    if (peer.iceGatheringState === "complete") return resolve();
    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") resolve();
    });
    setTimeout(resolve, GATHER_TIMEOUT_MS);
  });

  void (async () => {
    try {
      await peer.setLocalDescription(await peer.createOffer());
      await gathered;
      const sdp = peer.localDescription?.sdp;
      if (closed || !sdp) return end();
      offer({ id, sdp });
    } catch {
      end();
    }
  })();

  return {
    id,
    answer(answerId, sdp) {
      if (closed || answerId !== id) return;
      peer.setRemoteDescription({ type: "answer", sdp }).catch(end);
    },
    close(drainMs = 0) {
      if (closed || draining) return;
      if (drainMs <= 0) return end();
      draining = true;
      setTimeout(end, drainMs);
    },
  };
}
