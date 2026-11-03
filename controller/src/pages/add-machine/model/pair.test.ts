import { afterEach, expect, test } from "bun:test";
import { buildPairingLink, createSigner, fromBase64url, handshakeBytes, parsePairingLink, publicKeyOf, toBase64url, verifySignature, type PairingLink } from "@veeloe/protocol";
import { createKeySession, type Vault } from "../../../shared/keystore/session";
import { pairAfterAuthentication, pairMachine } from "./pair";

// TEST-ONLY KEYS.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const strangerSeed = new Uint8Array(32).fill(0x22);
const member = "m_test";
const machineId = "machine-1";

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((f) => f()));

/** A Hub that answers the REST call and speaks the handshake; a test plays the relay through `onClaim`. */
function fakeHub({ pairings = () => Response.json({ workspace: "w-1", member, machine: machineId }), onClaim = () => {} }: { pairings?: (body: unknown) => Response; onClaim?: (frame: { sig: string; signed: string; from: string }, reply: (frame: unknown) => void) => void } = {}) {
  const hub = { requests: [] as unknown[], claims: [] as { from: string; signed: string; sig: string }[], url: "", server: undefined as unknown as ReturnType<typeof Bun.serve> };
  hub.server = Bun.serve<{ nonce: string; authed?: boolean }>({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, server) {
      if (new URL(req.url).pathname === "/pairings") {
        const body = await req.json();
        hub.requests.push(body);
        return pairings(body);
      }
      const nonce = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
      return server.upgrade(req, { data: { nonce } }) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open: (ws) => void ws.send(JSON.stringify({ type: "hub.challenge", v: 1, nonce: ws.data.nonce })),
      message(ws, raw) {
        const frame = JSON.parse(String(raw));
        if (!ws.data.authed) {
          const good = verifySignature(fromBase64url(frame.sig), handshakeBytes(hub.url, ws.data.nonce), fromBase64url(frame.key));
          if (!good) return ws.close(4401, "no");
          ws.data.authed = true;
          ws.send(JSON.stringify({ type: "hub.ready", member }));
          return;
        }
        hub.claims.push(frame);
        onClaim(frame, (out) => ws.send(JSON.stringify(out)));
      },
    },
  });
  hub.url = `ws://127.0.0.1:${hub.server.port}`;
  stops.push(() => hub.server.stop(true));
  return hub;
}

function linkFor(hubUrl: string): PairingLink {
  const text = buildPairingLink({ hub: hubUrl, machineSecretKey: machineSeed, secret: new Uint8Array(32).fill(0x55), expires: Math.floor(Date.now() / 1000) + 600 });
  const parsed = parsePairingLink(text, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.link;
}

const done = (seed = machineSeed, seq = 1) => createSigner(seed, () => seq)({ type: "pairing.done", recipients: [member], body: { name: "my-mac" } });
const fast = { retryMs: 20, giveUpAt: Date.now() + 2000 };

test("registers with both signatures, claims with the proof and takes the Machine's answer", async () => {
  const hub = fakeHub({ onClaim: (_, reply) => reply(done()) });
  const link = linkFor(hub.url);
  const result = await pairMachine({ link, secretKey: controllerSeed, ...fast });
  expect(result).toEqual({ ok: true, machine: { id: machineId, publicKey: toBase64url(publicKeyOf(machineSeed)), name: "my-mac", hubUrl: hub.url, workspace: "w-1", member } });
  expect(hub.requests[0]).toMatchObject({ machine: link.machine, controller: toBase64url(publicKeyOf(controllerSeed)), machineSig: link.sig });
  expect(JSON.stringify(hub.requests) + JSON.stringify(hub.claims)).not.toContain(link.secret);
});

test("a Hub that says the Machine is offline gets the claim again, until the Machine is there", async () => {
  let tries = 0;
  const hub = fakeHub({
    onClaim: (frame, reply) => {
      tries++;
      if (tries < 3) reply({ type: "hub.error", code: "hub.machine_offline", ref: frame.sig });
      else reply(done());
    },
  });
  const result = await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, ...fast });
  expect(result.ok).toBe(true);
  expect(tries).toBe(3);
});

test("the last thing the Hub said is the problem shown when time runs out", async () => {
  const hub = fakeHub({ onClaim: (frame, reply) => reply({ type: "hub.error", code: "hub.machine_offline", ref: frame.sig }) });
  const result = await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, retryMs: 20, giveUpAt: Date.now() + 100 });
  expect(result).toEqual({ ok: false, code: "hub.machine_offline" });
});

test("no answer at all times out with its own code", async () => {
  const hub = fakeHub();
  expect(await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, retryMs: 20, giveUpAt: Date.now() + 100 })).toEqual({ ok: false, code: "pairing.timed_out" });
});

test("an answer signed by another key does not count, and the real one still does", async () => {
  let tries = 0;
  const hub = fakeHub({ onClaim: (_, reply) => reply(++tries === 1 ? done(strangerSeed) : done()) });
  const result = await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, ...fast });
  expect(result.ok).toBe(true);
  expect(tries).toBeGreaterThan(1);
});

test("an answer from another key alone ends in a timeout, with no Machine", async () => {
  const hub = fakeHub({ onClaim: (_, reply) => reply(done(strangerSeed)) });
  expect((await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, retryMs: 20, giveUpAt: Date.now() + 100 })).ok).toBe(false);
});

test("a refusal from the Hub comes back as its code, and no connection is opened", async () => {
  const hub = fakeHub({ pairings: () => Response.json({ error: { code: "hub.machine_taken", message: "taken" } }, { status: 409 }) });
  expect(await pairMachine({ link: linkFor(hub.url), secretKey: controllerSeed, ...fast })).toEqual({ ok: false, code: "hub.machine_taken" });
  expect(hub.claims).toEqual([]);
});

test("a Hub that cannot be reached has its own code", async () => {
  const hub = fakeHub();
  const link = linkFor(hub.url);
  hub.server.stop(true);
  expect(await pairMachine({ link, secretKey: controllerSeed, ...fast })).toEqual({ ok: false, code: "pairing.hub_unreachable" });
});

test("cancelling the authentication sends nothing and leaves the app unlocked", async () => {
  const hub = fakeHub();
  const secret = new Uint8Array(32).fill(0x44);
  let reads = 0;
  const vault: Vault = {
    isSupported: async () => true,
    hasKey: async () => true,
    create: async () => {},
    read: async () => {
      if (reads++ === 0) return secret.slice();
      throw new Error("cancelled");
    },
  };
  const session = createKeySession({ vault, now: Date.now, generate: () => secret.slice() });
  await session.load();
  await session.unlock("open");
  expect(session.status()).toBe("unlocked");

  const result = await pairAfterAuthentication((use) => session.withFreshAuthentication("pair", use), { link: linkFor(hub.url), ...fast });
  expect(result).toBeNull();
  expect(hub.requests).toEqual([]);
  expect(session.status()).toBe("unlocked");
});
