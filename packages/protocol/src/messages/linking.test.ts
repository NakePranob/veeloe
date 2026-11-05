import { expect, test } from "bun:test";
import { parseFrame } from "../frame";
import { publicKeyOf } from "../crypto/ed25519";
import { toBase64url } from "../crypto/base64url";
import { revokedWith, signCertificate, verifyCertificate } from "./certificate";
import { buildLinkingLink, checkLinkingProof, linkingProof, parseLinkingLink } from "./linking";
import { PAIRING_CLOCK_SKEW_SECONDS } from "./pairing-link";

// TEST-ONLY KEYS.
const oldSeed = new Uint8Array(32).fill(0x44);
const newSeed = new Uint8Array(32).fill(0x66);
const key = toBase64url(publicKeyOf(newSeed));
const secret = new Uint8Array(32).fill(0x55);
const expires = 2_000_000_000;
const now = (expires - 60) * 1000;
const text = buildLinkingLink({ hub: "WSS://Hub.Example.com/", key, name: "iPad & co", secret, expires });

test("a link reads back with its Hub in normal form and its name decoded", () => {
  expect(parseLinkingLink(` ${text}\n`, now)).toEqual({ ok: true, link: { hub: "wss://hub.example.com", key, name: "iPad & co", secret: toBase64url(secret), expires } });
});

test("a link past its expiry is refused, after the allowance for clocks", () => {
  expect(parseLinkingLink(text, (expires + PAIRING_CLOCK_SKEW_SECONDS - 1) * 1000).ok).toBe(true);
  expect(parseLinkingLink(text, (expires + PAIRING_CLOCK_SKEW_SECONDS + 1) * 1000)).toEqual({ ok: false, reason: "expired" });
});

test.each([
  ["a Pairing link", text.replace("veeloe://link?", "veeloe://pair?")],
  ["no key", text.replace(/key=[^&]*&/, "")],
  ["a short secret", text.replace(toBase64url(secret), "AAAA")],
  ["a Hub that is not a Hub URL", text.replace(/hub=[^&]*/, "hub=https%3A%2F%2Fhub.example.com")],
  ["an empty name", text.replace(/name=[^&]*/, "name=%20")],
  ["an expiry that is not a number", text.replace(String(expires), "soon")],
])("%s is malformed, without throwing", (_, value) => {
  expect(parseLinkingLink(value, now)).toEqual({ ok: false, reason: "malformed" });
});

test("the proof changes with the new key, the handoff text and the secret", () => {
  const input = { secret: toBase64url(secret), key, data: '{"machines":[]}' };
  const proof = linkingProof(input);
  expect(checkLinkingProof(input, proof)).toBe(true);
  for (const change of [{ key: toBase64url(publicKeyOf(oldSeed)) }, { data: '{"machines":[1]}' }, { secret: toBase64url(new Uint8Array(32).fill(0x77)) }]) {
    expect(checkLinkingProof({ ...input, ...change }, proof)).toBe(false);
  }
});

test("a certificate checks out only as signed, and names its signer", () => {
  const body = { type: "device.link", workspace: "w", member: "m", key, name: "Chrome", at: 1 } as const;
  const cert = signCertificate(body, oldSeed);
  expect(verifyCertificate(cert)).toMatchObject({ type: "device.link", key, by: toBase64url(publicKeyOf(oldSeed)) });
  expect(verifyCertificate({ ...cert, signed: cert.signed.replace('"m"', '"n"') })).toBeNull();
  expect(verifyCertificate({ ...cert, sig: signCertificate(body, newSeed).sig })).toBeNull();
  expect(verifyCertificate({ signed: "not json", sig: cert.sig })).toBeNull();
  expect(parseFrame(JSON.stringify({ type: "hub.certificates", certificates: [cert] })).kind).toBe("message");
});

test("revoking takes what the key linked, and down from there, but not what is kept", () => {
  const links = [
    { key: "B", by: "A" },
    { key: "C", by: "B" },
    { key: "D", by: "A" },
  ];
  expect(revokedWith("A", links, [])).toEqual(["A", "B", "D", "C"]);
  expect(revokedWith("A", links, ["B"])).toEqual(["A", "D"]);
  expect(revokedWith("C", links, [])).toEqual(["C"]);
});
