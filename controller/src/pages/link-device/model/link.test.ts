import { expect, test } from "bun:test";
import { checkLinkingProof, createSigner, linkRequestProof, parseLinkingLink, publicKeyOf, toBase64url, verifyCertificate, type HubLinkRequest, type SignedPart } from "@veeloe/protocol-ts";
import type { Device } from "../../../entities/device";
import type { Machine } from "../../../entities/machine";
import { approveLink, handOff, handoffData, nameProblem, openLink } from "./link";

// TEST-ONLY KEYS.
const oldSeed = new Uint8Array(32).fill(0x44);
const newSeed = new Uint8Array(32).fill(0x66);
const strangerSeed = new Uint8Array(32).fill(0x77);
const ownKey = toBase64url(publicKeyOf(oldSeed));
const newKey = toBase64url(publicKeyOf(newSeed));
const hub = "wss://hub.example.com";
const machine: Machine = { id: "machine-1", public_key: "mk", name: "mac", hub_url: hub, workspace_id: "w_1", member_id: "m_1", paired_at: 1, egress: "[]" };
const device = (key: string, name: string, revoked = false): Device => ({ key, member_id: "m_1", name, linked_by: null, linked_at: null, revoked_at: revoked ? 1 : null });

/** What the new device sends, read from the link it scanned, as the Hub hands it on. */
function requestFrom(text: string, key = newKey, name = "Chrome"): HubLinkRequest {
  const parsed = parseLinkingLink(text, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  const { id, secret } = parsed.link;
  return { type: "hub.link_request", id, key, name, proof: linkRequestProof({ secret, id, key, name }) };
}

test("the QR carries this device's Hub, its key and a fresh secret and id each time", () => {
  const one = openLink({ hub, ownKey });
  const two = openLink({ hub, ownKey });
  expect(parseLinkingLink(one.text, Date.now())).toEqual({ ok: true, link: one.link });
  expect(one.link).toMatchObject({ hub, to: ownKey });
  expect(one.link.secret).not.toBe(two.link.secret);
  expect(one.link.id).not.toBe(two.link.id);
});

test("a request whose proof does not match is nothing: the Hub cannot swap the key, change the name or make one up", () => {
  const offer = openLink({ hub, ownKey });
  const real = requestFrom(offer.text);
  expect(offer.take({ ...real, key: toBase64url(publicKeyOf(strangerSeed)) })).toBeNull();
  expect(offer.take({ ...real, name: "My iPad" })).toBeNull();
  expect(offer.take({ ...real, id: openLink({ hub, ownKey }).link.id })).toBeNull();
  expect(offer.take(requestFrom(openLink({ hub, ownKey }).text))).toBeNull();
  // None of those used the link up.
  expect(offer.take(real)).toEqual({ key: newKey, name: "Chrome" });
});

test("a link works once: a second request, even with the right proof, is nothing", () => {
  const offer = openLink({ hub, ownKey });
  expect(offer.take(requestFrom(offer.text))).toEqual({ key: newKey, name: "Chrome" });
  expect(offer.take(requestFrom(offer.text, toBase64url(publicKeyOf(strangerSeed)), "Other"))).toBeNull();
  expect(offer.take(requestFrom(offer.text))).toBeNull();
});

test("a request after the link ran out is nothing", () => {
  let at = Date.now();
  const offer = openLink({ hub, ownKey, ttlSeconds: 600, now: () => at });
  const request = requestFrom(offer.text);
  at += 601_000;
  expect(offer.take(request)).toBeNull();
});

test("a new name must not be empty or the name of another device in use", () => {
  const devices = [device("a", "iPhone"), device("b", "Old iPad", true)];
  expect(nameProblem("  ", devices)).toBe("empty");
  expect(nameProblem(" iPhone ", devices)).toBe("taken");
  expect(nameProblem("Old iPad", devices)).toBeNull();
});

test("a request that checked out is not linked until the owner approves: cancelling the authentication signs and sends nothing", async () => {
  const offer = openLink({ hub, ownKey });
  const ask = offer.take(requestFrom(offer.text))!;
  let fetched = 0;
  const fetchFn = (async () => (fetched++, Response.json({}))) as unknown as typeof fetch;
  expect(await approveLink(async () => false, { link: offer.link, ask, name: "Chrome", machine, fetchFn })).toBeNull();
  expect(fetched).toBe(0);
});

test("approving signs a link of the requested key into this Member and posts it to this device's Hub", async () => {
  const offer = openLink({ hub, ownKey });
  const ask = offer.take(requestFrom(offer.text))!;
  const sent: { url: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => (sent.push({ url, body: JSON.parse(String(init.body)) }), Response.json({}))) as unknown as typeof fetch;
  const answer = await approveLink(async (use) => (await use(oldSeed), true), { link: offer.link, ask, name: " Work laptop ", machine, fetchFn });
  expect(answer).toEqual({ ok: true });
  expect(sent[0]!.url).toBe("https://hub.example.com/links");
  expect(verifyCertificate(sent[0]!.body)).toMatchObject({ type: "device.link", workspace: "w_1", member: "m_1", key: newKey, name: "Work laptop", by: ownKey });
  const refused = (async () => Response.json({ error: { code: "hub.key_taken" } }, { status: 409 })) as unknown as typeof fetch;
  expect(await approveLink(async (use) => (await use(oldSeed), true), { link: offer.link, ask, name: "x", machine, fetchFn: refused })).toEqual({ ok: false, code: "hub.key_taken" });
});

test("the handoff goes again until the new key says linked, and its proof covers exactly what was sent", async () => {
  const { link } = openLink({ hub, ownKey });
  const data = handoffData(hub, [machine, { ...machine, id: "elsewhere", hub_url: "wss://other.example.com" }], [device("a", "iPhone"), device("b", "gone", true)]);
  expect(JSON.parse(data)).toEqual({ workspace: "w_1", member: "m_1", machines: [{ id: "machine-1", key: "mk", name: "mac", hub }], keys: [{ key: "a", name: "iPhone" }] });

  let handler: ((signed: SignedPart) => void) | undefined;
  const sends: { proof: string; data: string }[] = [];
  const result = handOff({
    link,
    key: newKey,
    data,
    retryMs: 10,
    send: (_, body) => {
      sends.push(body as { proof: string; data: string });
      if (sends.length === 3) handler!(JSON.parse(createSigner(newSeed, () => 1)({ type: "device.linked", recipients: ["m_1"], body: {} }).signed));
    },
    watch: (key, h) => {
      // A linked from another key is not read: the watch is only on the new key.
      expect(key).toBe(newKey);
      handler = h;
      return () => (handler = undefined);
    },
  });
  expect(await result).toBe("linked");
  expect(sends.length).toBe(3);
  expect(checkLinkingProof({ secret: link.secret, key: newKey, data }, sends[0]!.proof)).toBe(true);
  expect(handler).toBeUndefined();
});

test("with no answer, the handoff stops when the link runs out", async () => {
  const { link } = openLink({ hub, ownKey });
  expect(await handOff({ link, key: newKey, data: "{}", retryMs: 10, giveUpAt: Date.now() + 50, send: () => {}, watch: () => () => {} })).toBe("expired");
});
