import { afterEach, expect, test } from "bun:test";
import { createSigner, fromBase64url, handshakeBytes, linkingProof, parseLinkingLink, publicKeyOf, toBase64url, verifySignature, type Envelope } from "@veeloe/protocol";
import { hubFrom, waitForHandoff } from "./wait";

// TEST-ONLY KEYS.
const newSeed = new Uint8Array(32).fill(0x66);
const oldSeed = new Uint8Array(32).fill(0x44);
const member = "m_1";

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((f) => f()));

/** A Hub that refuses the key with 4401 until `accept`, then lets a test play the old device. */
function fakeHub() {
  const hub = { accept: false, url: "", frames: [] as Envelope[], sockets: [] as { send(s: string): void }[], refused: 0 };
  const server = Bun.serve<{ nonce: string; authed?: boolean }>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, s) => (s.upgrade(req, { data: { nonce: toBase64url(crypto.getRandomValues(new Uint8Array(32))) } }) ? undefined : new Response("no", { status: 400 })),
    websocket: {
      open: (ws) => void ws.send(JSON.stringify({ type: "hub.challenge", v: 1, nonce: ws.data.nonce })),
      message(ws, raw) {
        const frame = JSON.parse(String(raw));
        if (ws.data.authed) return void hub.frames.push(frame);
        const good = verifySignature(fromBase64url(frame.sig), handshakeBytes(hub.url, ws.data.nonce), fromBase64url(frame.key));
        if (!good || !hub.accept) {
          hub.refused++;
          return ws.close(4401, "no");
        }
        ws.data.authed = true;
        hub.sockets.push(ws);
        ws.send(JSON.stringify({ type: "hub.ready", member }));
      },
    },
  });
  hub.url = `ws://127.0.0.1:${server.port}`;
  stops.push(() => server.stop(true));
  return { hub, push: (frame: unknown) => hub.sockets.at(-1)!.send(JSON.stringify(frame)) };
}

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

const data = JSON.stringify({ workspace: "w_1", member, machines: [{ id: "machine-1", key: "mk", name: "mac", hub: "ws://x" }], keys: [{ key: toBase64url(publicKeyOf(oldSeed)), name: "iPhone" }] });
let seq = 1;
const handoff = (body: unknown, type = "device.handoff") => createSigner(oldSeed, () => seq++)({ type, recipients: [member], body });

async function started() {
  const { hub, push } = fakeHub();
  const wait = waitForHandoff({ hub: hub.url, name: "Chrome", secretKey: newSeed.slice() });
  stops.push(wait.stop);
  const parsed = parseLinkingLink(wait.text, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  await until(() => hub.refused > 0);
  // The old device registers the key at the Hub.
  hub.accept = true;
  await until(() => hub.sockets.length === 1);
  return { hub, push, wait, link: parsed.link };
}

test("the QR holds the Hub, this key, the name and a fresh secret; a Hub address that is not one is caught first", () => {
  expect(hubFrom(" WSS://Hub.Example.com/ ")).toBe("wss://hub.example.com");
  expect(hubFrom("https://hub.example.com")).toBeNull();
  const one = waitForHandoff({ hub: "ws://127.0.0.1:1", name: "Chrome", secretKey: newSeed.slice() });
  const two = waitForHandoff({ hub: "ws://127.0.0.1:1", name: "Chrome", secretKey: newSeed.slice() });
  stops.push(one.stop, two.stop);
  const a = parseLinkingLink(one.text, Date.now());
  const b = parseLinkingLink(two.text, Date.now());
  if (!a.ok || !b.ok) throw new Error("link");
  expect(a.link).toMatchObject({ key: toBase64url(publicKeyOf(newSeed)), name: "Chrome", hub: "ws://127.0.0.1:1" });
  expect(a.link.secret).not.toBe(b.link.secret);
});

test("a handoff with the right proof is taken, and the new key answers linked to its own Member", async () => {
  const { hub, push, wait, link } = await started();
  push(handoff({ data, proof: linkingProof({ secret: link.secret, key: link.key, data }) }));
  expect(await wait.done).toMatchObject({ ok: true, data: { workspace: "w_1", member, machines: [{ id: "machine-1" }] } });
  await until(() => hub.frames.length === 1);
  expect(hub.frames[0]).toMatchObject({ type: "device.linked", recipients: [member], from: link.key });
});

test("a handoff whose proof does not match, or another kind of envelope, is ignored, and the wait goes on to its end", async () => {
  const { push, wait, link } = await started();
  const swapped = data.replace("machine-1", "machine-evil");
  push(handoff({ data: swapped, proof: linkingProof({ secret: link.secret, key: link.key, data }) }));
  push(handoff({ data, proof: linkingProof({ secret: toBase64url(new Uint8Array(32).fill(1)), key: link.key, data }) }));
  push(handoff({ data, proof: linkingProof({ secret: link.secret, key: link.key, data }) }, "task.event"));
  const early = await Promise.race([wait.done, Bun.sleep(150).then(() => "still waiting")]);
  expect(early).toBe("still waiting");
  wait.stop();
  expect(await wait.done).toEqual({ ok: false, code: "linking.expired" });
});

test("with no handoff the wait ends when the link does", async () => {
  const wait = waitForHandoff({ hub: "ws://127.0.0.1:1", name: "Chrome", secretKey: newSeed.slice(), ttlSeconds: 0.05 });
  expect(await wait.done).toEqual({ ok: false, code: "linking.expired" });
});
