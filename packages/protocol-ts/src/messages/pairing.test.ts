import { expect, test } from "bun:test";
import { parseMessage } from ".";
import { publicKeyOf, verifySignature } from "../crypto/ed25519";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { checkPairingProof, pairingProof, PairingClaimBodySchema } from "./pairing-claim";
import { buildPairingLink, buildPairingRequest, hubHttpUrl, PAIRING_CLOCK_SKEW_SECONDS, pairingRequestBytes, parsePairingLink } from "./pairing-link";

// TEST-ONLY KEYS.
const machineSecretKey = new Uint8Array(32).fill(0x33);
const controllerSecretKey = new Uint8Array(32).fill(0x44);
const secret = new Uint8Array(32).fill(0x55);
const expires = 2_000_000_000;
const now = (expires - 60) * 1000;
const hub = "wss://hub.example.com";
const text = buildPairingLink({ hub, machineSecretKey, secret, expires });

const key = (seed: Uint8Array) => toBase64url(publicKeyOf(seed));
const input = { secret: toBase64url(secret), machine: key(machineSecretKey), controller: key(controllerSecretKey), member: "m_1" };

test("a link the Machine signed reads back, with surrounding whitespace from a paste", () => {
  expect(parsePairingLink(`  ${text}\n`, now)).toEqual({
    ok: true,
    link: { hub, machine: input.machine, secret: input.secret, expires, sig: expect.any(String) },
  });
});

test.each([
  ["another Hub", (l: string) => l.replace("hub.example.com", "evil.example.com")],
  ["another Machine", (l: string) => l.replace(input.machine, key(new Uint8Array(32).fill(0x22)))],
  ["a later expiry", (l: string) => l.replace(String(expires), String(expires + 1000))],
])("a link changed to %s fails its signature", (_, change) => {
  expect(parsePairingLink(change(text), now)).toEqual({ ok: false, reason: "bad-signature" });
});

test("a link past its expiry is refused, after the allowance for clocks", () => {
  expect(parsePairingLink(text, (expires + PAIRING_CLOCK_SKEW_SECONDS - 1) * 1000).ok).toBe(true);
  expect(parsePairingLink(text, (expires + PAIRING_CLOCK_SKEW_SECONDS + 1) * 1000)).toEqual({ ok: false, reason: "expired" });
});

test.each([
  ["not a link", "hello"],
  ["another scheme", text.replace("veeloe://", "https://")],
  ["no secret", text.replace(/secret=[^&]*&/, "")],
  ["a short secret", text.replace(input.secret, "AAAA")],
  ["a Hub that is not a Hub URL", text.replace(/hub=[^&]*/, "hub=https%3A%2F%2Fhub.example.com")],
  ["an expiry that is not a number", text.replace(String(expires), "soon")],
])("%s is malformed, without throwing", (_, value) => {
  expect(parsePairingLink(value, now)).toEqual({ ok: false, reason: "malformed" });
});

test("the request carries both signatures and no secret, and the Controller's is bound to the Hub", () => {
  const parsed = parsePairingLink(text, now);
  if (!parsed.ok) throw new Error(parsed.reason);
  const request = buildPairingRequest(parsed.link, controllerSecretKey);
  expect(JSON.stringify(request)).not.toContain(input.secret);
  const sig = fromBase64url(request.controllerSig);
  const pub = publicKeyOf(controllerSecretKey);
  expect(verifySignature(sig, pairingRequestBytes(hub, request.machine, request.controller, expires), pub)).toBe(true);
  expect(verifySignature(sig, pairingRequestBytes("wss://evil.example.com", request.machine, request.controller, expires), pub)).toBe(false);
});

test("the proof changes with either key, the Member and the secret", () => {
  const proof = pairingProof(input);
  expect(checkPairingProof(input, proof)).toBe(true);
  for (const change of [
    { machine: key(new Uint8Array(32).fill(0x22)) },
    { controller: key(new Uint8Array(32).fill(0x22)) },
    { member: "m_2" },
    { secret: toBase64url(new Uint8Array(32).fill(0x66)) },
  ]) {
    expect(pairingProof({ ...input, ...change })).not.toBe(proof);
    expect(checkPairingProof({ ...input, ...change }, proof)).toBe(false);
  }
  expect(checkPairingProof(input, proof.slice(1))).toBe(false);
});

test("a claim holds proof of the secret, never the secret", () => {
  const body = PairingClaimBodySchema.parse({ member: input.member, proof: pairingProof(input) });
  expect(JSON.stringify(body)).not.toContain(input.secret);
  expect(parseMessage({ type: "pairing.claim", body })).toEqual({ kind: "message", message: { type: "pairing.claim", body } });
  expect(parseMessage({ type: "pairing.claim", body: { member: "m_1" } })).toEqual({ kind: "invalid" });
  expect(parseMessage({ type: "pairing.done", body: { name: "my-mac" } }).kind).toBe("message");
  expect(parseMessage({ type: "pairing.done", body: {} })).toEqual({ kind: "invalid" });
});

test("the Hub's HTTP address follows its WebSocket scheme", () => {
  expect(hubHttpUrl("wss://hub.example.com/")).toBe("https://hub.example.com");
  expect(hubHttpUrl("ws://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
});
