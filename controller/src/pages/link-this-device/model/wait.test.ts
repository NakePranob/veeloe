import { afterEach, expect, test } from "bun:test";
import { buildLinkingLink, checkLinkRequestProof, createSigner, fromBase64url, handshakeBytes, linkingProof, publicKeyOf, toBase64url, verifySignature, type Envelope, type LinkingLink } from "@veeloe/protocol";
import { readLink, sendLinkRequest, waitForHandoff } from "./wait";

// TEST-ONLY KEYS.
const newSeed = new Uint8Array(32).fill(0x66);
const oldSeed = new Uint8Array(32).fill(0x44);
const member = "m_1";
const secret = new Uint8Array(32).fill(0x55);
const linkOn = (hub: string, expires = Math.floor(Date.now() / 1000) + 600): LinkingLink => ({
  hub,
  to: toBase64url(publicKeyOf(oldSeed)),
  id: toBase64url(new Uint8Array(16).fill(0x11)),
  secret: toBase64url(secret),
  expires,
});

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
const key = toBase64url(publicKeyOf(newSeed));

async function started() {
  const { hub, push } = fakeHub();
  const link = linkOn(hub.url);
  const wait = waitForHandoff({ link, secretKey: newSeed.slice() });
  stops.push(wait.stop);
  await until(() => hub.refused > 0);
  // The old device registers the key at the Hub.
  hub.accept = true;
  await until(() => hub.sockets.length === 1);
  return { hub, push, wait, link };
}

test("a link read here names its Hub; one malformed or expired is refused before anything goes anywhere", () => {
  const text = buildLinkingLink({ ...linkOn("WSS://Hub.Example.com/"), secret });
  expect(readLink(` ${text} `)).toMatchObject({ ok: true, link: { hub: "wss://hub.example.com" } });
  expect(readLink("veeloe://pair?x")).toEqual({ ok: false, code: "linking.link_malformed" });
  expect(readLink(buildLinkingLink({ ...linkOn("wss://hub.example.com", 1000), secret }))).toEqual({ ok: false, code: "linking.link_expired" });
});

test("the request goes to the link's Hub for the showing device, with this key and name under the secret's proof", async () => {
  const sent: { url: string; body: { to: string; id: string; key: string; name: string; proof: string } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => (sent.push({ url, body: JSON.parse(String(init.body)) }), Response.json({}))) as unknown as typeof fetch;
  const link = linkOn("wss://hub.example.com");
  expect(await sendLinkRequest({ link, name: " Chrome ", secretKey: newSeed, fetchFn })).toEqual({ ok: true });
  expect(sent[0]!.url).toBe("https://hub.example.com/link-requests");
  const body = sent[0]!.body;
  expect(body).toMatchObject({ to: link.to, id: link.id, key, name: "Chrome" });
  expect(checkLinkRequestProof({ secret: link.secret, id: link.id, key, name: "Chrome" }, body.proof)).toBe(true);
  const offline = (async () => Response.json({ error: { code: "hub.device_offline" } }, { status: 404 })) as unknown as typeof fetch;
  expect(await sendLinkRequest({ link, name: "Chrome", secretKey: newSeed, fetchFn: offline })).toEqual({ ok: false, code: "hub.device_offline" });
});

test("a handoff with the right proof is taken, and the new key answers linked to its own Member", async () => {
  const { hub, push, wait, link } = await started();
  push(handoff({ data, proof: linkingProof({ secret: link.secret, key, data }) }));
  expect(await wait.done).toMatchObject({ ok: true, data: { workspace: "w_1", member, machines: [{ id: "machine-1" }] } });
  await until(() => hub.frames.length === 1);
  expect(hub.frames[0]).toMatchObject({ type: "device.linked", recipients: [member], from: key });
});

test("a handoff whose proof does not match, or another kind of envelope, is ignored, and the wait goes on to its end", async () => {
  const { push, wait, link } = await started();
  const swapped = data.replace("machine-1", "machine-evil");
  push(handoff({ data: swapped, proof: linkingProof({ secret: link.secret, key, data }) }));
  push(handoff({ data, proof: linkingProof({ secret: toBase64url(new Uint8Array(32).fill(1)), key, data }) }));
  push(handoff({ data, proof: linkingProof({ secret: link.secret, key, data }) }, "task.event"));
  const early = await Promise.race([wait.done, Bun.sleep(150).then(() => "still waiting")]);
  expect(early).toBe("still waiting");
  wait.stop();
  expect(await wait.done).toEqual({ ok: false, code: "linking.expired" });
});

test("with no handoff the wait ends when the link does", async () => {
  const link = linkOn("ws://127.0.0.1:1", Math.floor(Date.now() / 1000));
  const wait = waitForHandoff({ link, secretKey: newSeed.slice(), now: () => link.expires * 1000 - 50 });
  expect(await wait.done).toEqual({ ok: false, code: "linking.expired" });
});
