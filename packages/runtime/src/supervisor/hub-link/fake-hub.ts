// Test helper, not a test: a stand-in Hub for the Runtime's own tests.
import { fromBase64url, handshakeBytes, toBase64url, verifySignature } from "@veeloe/protocol";
import type { Server, ServerWebSocket } from "bun";

type Connection = { nonce: string; authed?: boolean };

export type FakeHub = {
  url: string;
  connections: number;
  server: Server<Connection>;
  /** Whether a new connection is let in; a test flips it to play the Controller registering the key. */
  accept: boolean;
  /** Frames authenticated clients sent. */
  frames: unknown[];
  /** Hands a frame to every authenticated client. */
  send(frame: unknown): void;
};

/** A stand-in Hub: challenge, check the answer like the real one, ready or 4401. */
export function fakeHub({ accept = true, port = 0 } = {}): FakeHub {
  const clients = new Set<ServerWebSocket<Connection>>();
  const hub = {
    connections: 0,
    accept,
    frames: [] as unknown[],
    send: (frame: unknown) => clients.forEach((ws) => ws.send(JSON.stringify(frame))),
  } as FakeHub;
  hub.server = Bun.serve<Connection>({
    port,
    hostname: "127.0.0.1",
    fetch(req, server) {
      const nonce = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
      return server.upgrade(req, { data: { nonce } }) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        hub.connections++;
        ws.send(JSON.stringify({ type: "hub.challenge", v: 1, nonce: ws.data.nonce }));
      },
      message(ws, raw) {
        if (ws.data.authed) {
          hub.frames.push(JSON.parse(String(raw)));
          return;
        }
        const answer = JSON.parse(String(raw));
        const ok = verifySignature(fromBase64url(answer.sig), handshakeBytes(hub.url, ws.data.nonce), fromBase64url(answer.key));
        if (ok && hub.accept) {
          ws.data.authed = true;
          clients.add(ws);
          ws.send(JSON.stringify({ type: "hub.ready", machine: "machine-1" }));
        } else ws.close(4401, "authentication failed");
      },
      close(ws) {
        clients.delete(ws);
      },
    },
  });
  hub.url = `ws://127.0.0.1:${hub.server.port}`;
  return hub;
}
