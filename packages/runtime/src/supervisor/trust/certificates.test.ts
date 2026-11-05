import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, MemorySeenSequences, publicKeyOf, signCertificate, toBase64url, verify } from "@veeloe/protocol";
import { applyCertificates } from "./certificates";
import { loadTrust, saveTrust, type Trust } from "./store";

// TEST-ONLY KEYS.
const seed = (n: number) => new Uint8Array(32).fill(n);
const phone = seed(0x41);
const browser = seed(0x42);
const ipad = seed(0x43);
const stranger = seed(0x44);
const key = (s: Uint8Array) => toBase64url(publicKeyOf(s));
const member = "m_1";
const workspace = "w_1";

const paired = (): Trust => ({ owners: [{ member, keys: [key(phone)] }], workspace, links: [], revoked: [] });
const link = (by: Uint8Array, to: Uint8Array, over: Partial<{ member: string; workspace: string; at: number }> = {}) =>
  signCertificate({ type: "device.link", workspace, member, key: key(to), name: "device", at: 1, ...over }, by);
const revoke = (by: Uint8Array, what: Uint8Array, keep: Uint8Array[] = []) => signCertificate({ type: "device.revoke", workspace, member, key: key(what), keep: keep.map(key), at: 2 }, by);
const keysOf = (t: Trust) => t.owners[0]!.keys;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

test("a trust file from before Linking reads, with no links and nothing revoked", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-cert-"));
  dirs.push(home);
  mkdirSync(join(home, "runtime"));
  writeFileSync(join(home, "runtime/trust.json"), JSON.stringify({ owners: [{ member, keys: ["k"] }] }));
  expect(loadTrust(home)).toEqual({ owners: [{ member, keys: ["k"] }], links: [], revoked: [] });
});

test("a link signed by a trusted key of the same Member adds the key, and the same list again changes nothing", () => {
  const once = applyCertificates(paired(), [link(phone, browser)]);
  expect(keysOf(once)).toEqual([key(phone), key(browser)]);
  expect(once.links).toEqual([{ key: key(browser), by: key(phone) }]);
  expect(applyCertificates(once, [link(phone, browser)])).toEqual(once);
});

test.each([
  ["signed by a key this Machine does not trust", () => link(stranger, browser)],
  ["for another Member", () => link(phone, browser, { member: "m_2" })],
  ["for another Workspace", () => link(phone, browser, { workspace: "w_2" })],
  ["changed after signing", () => ({ ...link(phone, browser), signed: link(phone, browser).signed.replace(key(browser), key(stranger)) })],
])("a link %s adds nothing", (_, cert) => {
  expect(applyCertificates(paired(), [cert()])).toEqual(paired());
});

test("revoking drops the key and what it linked, keeps what was kept, and lists them all as revoked", () => {
  const linked = applyCertificates(paired(), [link(phone, browser), link(browser, ipad), link(browser, stranger)]);
  const after = applyCertificates(linked, [revoke(phone, browser, [ipad])]);
  expect(keysOf(after)).toEqual([key(phone), key(ipad)]);
  expect(after.revoked).toEqual([key(browser), key(stranger)]);
});

test("a revoked key never comes back, even from an old link or one dated before the revocation", () => {
  const revoked = applyCertificates(paired(), [link(phone, browser), link(browser, ipad), revoke(phone, browser)]);
  expect(keysOf(revoked)).toEqual([key(phone)]);
  // The Hub sends the old link again, and the revoked key vouches for a new one with an old date.
  const replayed = applyCertificates(revoked, [link(phone, browser), link(browser, stranger, { at: 0 }), link(phone, ipad)]);
  expect(keysOf(replayed)).toEqual([key(phone)]);
});

test("a revocation that would leave the Member no key is not followed", () => {
  const alone = applyCertificates(paired(), [revoke(phone, phone)]);
  expect(alone).toEqual(paired());
  // Revoking the phone also takes what it linked, so that is no way round it either.
  const two = applyCertificates(paired(), [link(phone, browser)]);
  expect(keysOf(applyCertificates(two, [revoke(browser, phone)]))).toEqual([key(phone), key(browser)]);
});

test("what is revoked survives a restart, and an envelope from the revoked key is dropped as untrusted", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-cert-"));
  dirs.push(home);
  saveTrust(home, applyCertificates(paired(), [link(phone, browser), revoke(phone, browser)]));
  const reloaded = loadTrust(home);
  expect(reloaded.revoked).toEqual([key(browser)]);
  const trusted = new Set(reloaded.owners.flatMap((o) => o.keys));
  const envelope = createSigner(browser, () => 1)({ type: "task.message", to: "machine-1", member, body: {} });
  expect(verify(envelope, trusted, () => true, new MemorySeenSequences())).toEqual({ ok: false, reason: "untrusted-key" });
});
