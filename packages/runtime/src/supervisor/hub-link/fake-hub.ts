// Test helper, not a test: a stand-in Hub for the Runtime's own tests.
import { fromBase64url, handshakeBytes, toBase64url, verifySignature } from "@veeloe/protocol";
import type { Server } from "bun";

export type FakeHub = { url: string; connections: number; server: Server<{ nonce: string }> };

/** A stand-in Hub: challenge, check the answer like the real one, ready or 4401. */
export function fakeHub({ accept = true, port = 0 } = {}): FakeHub {
  const hub = { connections: 0 } as FakeHub;
  hub.server = Bun.serve<{ nonce: string }>({
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
        const answer = JSON.parse(String(raw));
        const ok = verifySignature(fromBase64url(answer.sig), handshakeBytes(hub.url, ws.data.nonce), fromBase64url(answer.key));
        if (ok && accept) ws.send(JSON.stringify({ type: "hub.ready", machine: "machine-1" }));
        else ws.close(4401, "authentication failed");
      },
    },
  });
  hub.url = `ws://127.0.0.1:${hub.server.port}`;
  return hub;
}

