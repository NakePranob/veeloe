import { answerChallenge, HubCloseCode, parseFrame } from "@veeloe/protocol";
import { createBackoff } from "./backoff";

export type HubLinkOptions = {
  hubUrl: string;
  secretKey: Uint8Array;
  log?: (line: string) => void;
  backoff?: ReturnType<typeof createBackoff>;
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
export function startHubLink({ hubUrl, secretKey, log = console.log, backoff = createBackoff() }: HubLinkOptions) {
  const url = `${hubUrl.replace(/\/+$/, "")}/connect`;
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    let ready = false;
    const ws = new WebSocket(url);
    socket = ws;

    ws.onmessage = (event) => {
      const frame = parseFrame(String(event.data));
      if (frame.kind !== "message") return; // unknown or unreadable: skip (ADR 0023)
      const msg = frame.message;
      if (msg.type === "hub.challenge" && !ready) {
        ws.send(JSON.stringify(answerChallenge(hubUrl, msg.nonce, secretKey)));
      } else if (msg.type === "hub.ready" && !ready) {
        ready = true;
        backoff.reset();
        log(`connected to hub ${hubUrl} as machine ${msg.machine}`);
      }
    };

    ws.onclose = (event) => {
      if (socket === ws) socket = undefined;
      if (stopped) return;
      const why = closeReasons[event.code] ?? (ready ? "connection lost" : "could not connect");
      const delay = backoff.next();
      log(`hub ${ready ? "connection closed" : "rejected or unreachable"}: ${why} (${event.code}); retrying in ${delay} ms`);
      retry = setTimeout(connect, delay);
    };
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
