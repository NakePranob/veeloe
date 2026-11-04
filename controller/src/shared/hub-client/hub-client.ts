import { answerChallenge, createBackoff, createSigner, MemorySeenSequences, parseFrame, verify, type HubError, type Outgoing, type Verified } from "@veeloe/protocol";
import { clockSequence } from "./sequence";

export type HubClientOptions = {
  hubUrl: string;
  secretKey: Uint8Array;
  /** Whose envelopes to read; anything else is dropped unread. */
  trustedKeys: { has(key: string): boolean };
  /** The Hub accepted the key, and named the Member holding this Controller. Called after every reconnect. */
  onReady?: (member: string) => void;
  onEnvelope?: (envelope: Extract<Verified, { ok: true }>) => void;
  /** Unsigned, so a hint about delivery and nothing more (ADR 0065). */
  onHubError?: (error: HubError) => void;
  backoff?: ReturnType<typeof createBackoff>;
};

/**
 * This Controller's one connection to a Hub (ADR 0022): proves the key, reconnects
 * with backoff until stop(), signs what goes out and checks what comes in.
 *
 * ponytail: the last number per sender is in memory. Keep it in SQLite when
 * Task events start arriving and a replay could change what is on screen.
 */
export function startHubClient({ hubUrl, secretKey, trustedKeys, onReady, onEnvelope, onHubError, backoff = createBackoff() }: HubClientOptions) {
  const url = `${hubUrl.replace(/\/+$/, "")}/connect`;
  const signEnvelope = createSigner(secretKey, clockSequence());
  const seen = new MemorySeenSequences();
  let member: string | undefined;
  let socket: WebSocket | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    const ws = new WebSocket(url);
    socket = ws;

    ws.onmessage = (event) => {
      const text = String(event.data);
      const frame = parseFrame(text);
      if (frame.kind === "message") {
        const message = frame.message;
        if (message.type === "hub.challenge" && member === undefined) {
          ws.send(JSON.stringify(answerChallenge(hubUrl, message.nonce, secretKey)));
        } else if (message.type === "hub.ready" && member === undefined && message.member !== undefined) {
          member = message.member;
          backoff.reset();
          onReady?.(member);
        } else if (message.type === "hub.error") {
          onHubError?.(message);
        }
      } else if (frame.kind === "unknown" && member !== undefined) {
        const mine = member;
        const result = verify(JSON.parse(text), trustedKeys, (route) => "recipients" in route && route.recipients.includes(mine), seen);
        if (result.ok) onEnvelope?.(result);
      }
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      member = undefined;
      if (!stopped) retry = setTimeout(connect, backoff.next());
    };
  }

  connect();
  return {
    /** The sent envelope's sig, which answers name it by; null when not connected, and nothing was signed or sent. */
    send(out: Outgoing): string | null {
      if (!socket || member === undefined) return null;
      const envelope = signEnvelope(out);
      socket.send(JSON.stringify(envelope));
      return envelope.sig;
    },
    /** The Member the Hub named for this Controller, once connected. */
    member: () => member,
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
      socket = undefined;
    },
  };
}
