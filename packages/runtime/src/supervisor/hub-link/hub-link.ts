import { answerChallenge, createBackoff, HubCloseCode, parseFrame } from "@veeloe/protocol";

export type HubLinkOptions = {
  hubUrl: string;
  secretKey: Uint8Array;
  log?: (line: string) => void;
  backoff?: ReturnType<typeof createBackoff>;
  /** The Hub accepted the key and named this Machine. */
  onReady?: (machine: string) => void;
  /** A frame that is not the Hub's own: an envelope, unverified. `send` writes back on the same connection. */
  onEnvelope?: (value: unknown, send: (frame: unknown) => void) => void;
};

const closeReasons: Record<number, string> = {
  [HubCloseCode.AuthFailed]: "the Hub does not know this Machine's key, or the answer did not check out",
  [HubCloseCode.HandshakeTimeout]: "the handshake took too long",
  [HubCloseCode.Replaced]: "another connection with this Machine's key took over",
};

/**
 * Keeps the Machine connected to its Hub: answers the challenge with the
 * Machine key, reports what the Hub says, and reconnects with backoff
 * whenever the connection drops or cannot be opened. Runs until stop().
 */
export function startHubLink({ hubUrl, secretKey, log = console.log, backoff = createBackoff(), onReady, onEnvelope }: HubLinkOptions) {
  const url = `${hubUrl.replace(/\/+$/, "")}/connect`;
  let stopped = false;
  let socket: WebSocket | undefined;
  let connected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    let ready = false;
    const ws = new WebSocket(url);
    socket = ws;
    connected = false;

    ws.onmessage = (event) => {
      const text = String(event.data);
      const frame = parseFrame(text);
      if (frame.kind === "unknown" && ready) onEnvelope?.(JSON.parse(text), (out) => ws.send(JSON.stringify(out)));
      if (frame.kind !== "message") return; // unreadable: skip (ADR 0023)
      const msg = frame.message;
      if (msg.type === "hub.challenge" && !ready) {
        ws.send(JSON.stringify(answerChallenge(hubUrl, msg.nonce, secretKey)));
      } else if (msg.type === "hub.ready" && !ready) {
        ready = true;
        connected = true;
        backoff.reset();
        log(`connected to hub ${hubUrl} as machine ${msg.machine}`);
        if (msg.machine) onReady?.(msg.machine);
      }
    };

    ws.onclose = (event) => {
      if (socket === ws) {
        socket = undefined;
        connected = false;
      }
      if (stopped) return;
      const why = closeReasons[event.code] ?? (ready ? "connection lost" : "could not connect");
      const delay = backoff.next();
      log(`hub ${ready ? "connection closed" : "rejected or unreachable"}: ${why} (${event.code}); retrying in ${delay} ms`);
      retry = setTimeout(connect, delay);
    };
  }

  connect();
  return {
    /** False while there is no accepted connection: the frame is not kept. */
    send(frame: unknown): boolean {
      if (!socket || !connected) return false;
      socket.send(JSON.stringify(frame));
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
