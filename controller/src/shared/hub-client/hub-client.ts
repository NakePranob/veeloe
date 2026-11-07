import { answerChallenge, createBackoff, createSigner, HubCloseCode, MemorySeenSequences, parseFrame, verify, type HubError, type HubLinkRequest, type Outgoing, type Verified } from "@veeloe/protocol";
import type { SeenSequences } from "@veeloe/protocol";
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
  /** The certificates the Hub keeps for the Workspace, unverified: all of them after connecting, then each new one. */
  onCertificates?: (certificates: unknown[]) => void;
  /** A new device read this device's Linking QR. Unsigned, and possibly made up by the Hub: only its proof makes it worth reading. */
  onLinkRequest?: (request: HubLinkRequest) => void;
  /** The Hub closed with 4403: this key was revoked. The client stops for good. */
  onRevoked?: () => void;
  /** Where the last number from each sender is kept; in memory when a caller has nothing better. */
  seen?: SeenSequences;
  /** Awaited before the first connection, so a number kept on disk is in hand before any envelope is checked. */
  seenReady?: Promise<unknown>;
  backoff?: ReturnType<typeof createBackoff>;
};

/**
 * This Controller's one connection to a Hub (ADR 0022): proves the key, reconnects
 * with backoff until stop(), signs what goes out and checks what comes in.
 *
 * The last number from each sender comes from the caller when it can keep it
 * (`protocol-envelope`): a Controller that forgot after a restart would accept
 * one replayed envelope.
 */
export function startHubClient({
  hubUrl,
  secretKey,
  trustedKeys,
  onReady,
  onEnvelope,
  onHubError,
  onCertificates,
  onLinkRequest,
  onRevoked,
  seen: kept,
  seenReady,
  backoff = createBackoff(),
}: HubClientOptions) {
  const url = `${hubUrl.replace(/\/+$/, "")}/connect`;
  const signEnvelope = createSigner(secretKey, clockSequence());
  const seen = kept ?? new MemorySeenSequences();
  let member: string | undefined;
  let socket: WebSocket | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  /** Set once the kept numbers are in hand, so no envelope is checked against an empty memory. */
  const began = seenReady ?? Promise.resolve();

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
        } else if (message.type === "hub.certificates" && member !== undefined) {
          onCertificates?.(message.certificates);
        } else if (message.type === "hub.link_request" && member !== undefined) {
          onLinkRequest?.(message);
        }
      } else if (frame.kind === "unknown" && member !== undefined) {
        const mine = member;
        const result = verify(JSON.parse(text), trustedKeys, (route) => "recipients" in route && route.recipients.includes(mine), seen);
        if (result.ok) onEnvelope?.(result);
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = undefined;
      member = undefined;
      if (event.code === HubCloseCode.Revoked && !stopped) {
        stopped = true;
        onRevoked?.();
        return;
      }
      if (!stopped) retry = setTimeout(connect, backoff.next());
    };
  }

  // The first connection waits for the kept numbers; a failure there still connects, as before.
  void began.then(() => !stopped && connect(), () => !stopped && connect());
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
