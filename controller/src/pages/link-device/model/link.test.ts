import { expect, test } from "bun:test";
import { buildLinkingLink, checkLinkingProof, createSigner, parseLinkingLink, publicKeyOf, toBase64url, verifyCertificate, type LinkingLink, type SignedPart } from "@veeloe/protocol";
import type { Device } from "../../../entities/device";
import type { Machine } from "../../../entities/machine";
import { approveLink, handOff, handoffData, nameProblem, readLink } from "./link";

// TEST-ONLY KEYS.
const oldSeed = new Uint8Array(32).fill(0x44);
const newSeed = new Uint8Array(32).fill(0x66);
const hub = "wss://hub.example.com";
const machine: Machine = { id: "machine-1", public_key: "mk", name: "mac", hub_url: hub, workspace_id: "w_1", member_id: "m_1", paired_at: 1, egress: "[]" };
const device = (key: string, name: string, revoked = false): Device => ({ key, member_id: "m_1", name, linked_by: null, linked_at: null, revoked_at: revoked ? 1 : null });
const text = (on = hub, expires = Math.floor(Date.now() / 1000) + 600) =>
  buildLinkingLink({ hub: on, key: toBase64url(publicKeyOf(newSeed)), name: "Chrome", secret: new Uint8Array(32).fill(0x55), expires });
const linkOf = (value: string): LinkingLink => {
  const parsed = parseLinkingLink(value, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.link;
};

test("a link to a Hub with none of this device's Machines is refused, as is one malformed or expired", () => {
  expect(readLink(text(), [machine])).toMatchObject({ ok: true, link: { name: "Chrome", hub } });
  expect(readLink(text("wss://evil.example.com"), [machine])).toEqual({ ok: false, code: "linking.hub_unknown" });
  expect(readLink("veeloe://pair?x", [machine])).toEqual({ ok: false, code: "linking.link_malformed" });
  expect(readLink(text(hub, 1000), [machine])).toEqual({ ok: false, code: "linking.link_expired" });
});

test("a new name must not be empty or the name of another device in use", () => {
  const devices = [device("a", "iPhone"), device("b", "Old iPad", true)];
  expect(nameProblem("  ", devices)).toBe("empty");
  expect(nameProblem(" iPhone ", devices)).toBe("taken");
  expect(nameProblem("Old iPad", devices)).toBeNull();
});

test("cancelling the authentication signs and sends nothing", async () => {
  let fetched = 0;
  const fetchFn = (async () => (fetched++, Response.json({}))) as unknown as typeof fetch;
  expect(await approveLink(async () => false, { link: linkOf(text()), name: "Chrome", machine, fetchFn })).toBeNull();
  expect(fetched).toBe(0);
});

test("approving signs a link of the new key into this Member and posts it to the link's Hub", async () => {
  const sent: { url: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => (sent.push({ url, body: JSON.parse(String(init.body)) }), Response.json({}))) as unknown as typeof fetch;
  const answer = await approveLink(async (use) => (await use(oldSeed), true), { link: linkOf(text()), name: " Work laptop ", machine, fetchFn });
  expect(answer).toEqual({ ok: true });
  expect(sent[0]!.url).toBe("https://hub.example.com/links");
  expect(verifyCertificate(sent[0]!.body)).toMatchObject({ type: "device.link", workspace: "w_1", member: "m_1", key: toBase64url(publicKeyOf(newSeed)), name: "Work laptop", by: toBase64url(publicKeyOf(oldSeed)) });
  const refused = (async () => Response.json({ error: { code: "hub.key_taken" } }, { status: 409 })) as unknown as typeof fetch;
  expect(await approveLink(async (use) => (await use(oldSeed), true), { link: linkOf(text()), name: "x", machine, fetchFn: refused })).toEqual({ ok: false, code: "hub.key_taken" });
});

test("the handoff goes again until the new key says linked, and its proof covers exactly what was sent", async () => {
  const link = linkOf(text());
  const data = handoffData(link, [machine, { ...machine, id: "elsewhere", hub_url: "wss://other.example.com" }], [device("a", "iPhone"), device("b", "gone", true)]);
  expect(JSON.parse(data)).toEqual({ workspace: "w_1", member: "m_1", machines: [{ id: "machine-1", key: "mk", name: "mac", hub }], keys: [{ key: "a", name: "iPhone" }] });

  let handler: ((signed: SignedPart) => void) | undefined;
  const sends: { proof: string; data: string }[] = [];
  const result = handOff({
    link,
    data,
    retryMs: 10,
    send: (_, body) => {
      sends.push(body as { proof: string; data: string });
      // A linked from another key is not read: the watch is only on the new key.
      if (sends.length === 3) handler!(JSON.parse(createSigner(newSeed, () => 1)({ type: "device.linked", recipients: ["m_1"], body: {} }).signed));
    },
    watch: (key, h) => {
      expect(key).toBe(link.key);
      handler = h;
      return () => (handler = undefined);
    },
  });
  expect(await result).toBe("linked");
  expect(sends.length).toBe(3);
  expect(checkLinkingProof({ secret: link.secret, key: link.key, data }, sends[0]!.proof)).toBe(true);
  expect(handler).toBeUndefined();
});

test("with no answer, the handoff stops when the link runs out", async () => {
  const link = linkOf(text());
  expect(await handOff({ link, data: "{}", retryMs: 10, giveUpAt: Date.now() + 50, send: () => {}, watch: () => () => {} })).toBe("expired");
});
