import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign, verifySignature } from "../crypto/ed25519";
import { EnvelopeSchema } from "../envelope/schema";
import { MemorySeenSequences, verify } from "../envelope/verify";
import { answerChallenge, handshakeBytes, normalizeHubUrl } from "../messages/hub-auth";

// The files every implementation checks itself against (Go included): the
// header's JSON Schema and the test vectors. Rebuild them with
// `bun run --cwd packages/protocol fixtures`.
//
// TEST-ONLY KEYS. Every secret below is a fixed, public seed. Never use one
// outside a test.
const TEST_SENDER = new Uint8Array(32).fill(0x11);
const TEST_STRANGER = new Uint8Array(32).fill(0x22);
const TEST_MACHINE = new Uint8Array(32).fill(0x33);

const encoder = new TextEncoder();
const keyOf = (secret: Uint8Array) => toBase64url(publicKeyOf(secret));
const sigOver = (text: string, secret: Uint8Array) => toBase64url(sign(encoder.encode(text), secret));

export function headerSchema() {
  return z.toJSONSchema(EnvelopeSchema);
}

type EnvelopeCase = { name: string; seen?: Record<string, number>; header: Record<string, unknown>; signed: string; secret?: Uint8Array };

function envelopeCases(): EnvelopeCase[] {
  const route = { type: "task.message", to: "agent-1", task: "task-1", member: "member-1" };
  const body = { text: "สวัสดี \"ครับ\" \\ bell:\u0007 tab:\t" };
  const plain = JSON.stringify({ ...route, seq: 8, body });
  return [
    { name: "valid, with Thai text and characters that need escaping", header: route, signed: plain },
    {
      name: "valid, with any key order, whitespace and \\u escapes in the signed bytes",
      header: route,
      signed: '{ "body" : { "text": "\\u0e2a\\u0e27\\u0e31\\u0e2a\\u0e14\\u0e35" },\n  "seq": 3, "member": "member-1", "task": "task-1", "to": "agent-1", "type": "task.message" }',
    },
    {
      name: "valid, with fields the receiver does not know in header and signed part",
      header: { ...route, hint: "newer sender" },
      signed: JSON.stringify({ ...route, seq: 4, body, priority: "high" }),
    },
    { name: "redirected to another destination", header: { ...route, to: "agent-2" }, signed: plain },
    { name: "swapped originating Member", header: { ...route, member: "member-2" }, signed: plain },
    { name: "changed message type", header: { ...route, type: "approval.answer" }, signed: plain },
    { name: "one changed byte in the signed part", header: route, signed: plain, secret: TEST_SENDER, tamper: true } as EnvelopeCase,
    { name: "untrusted sender key", header: route, signed: plain, secret: TEST_STRANGER },
    { name: "replayed sequence number", seen: { [keyOf(TEST_SENDER)]: 8 }, header: route, signed: plain },
    { name: "older sequence number", seen: { [keyOf(TEST_SENDER)]: 20 }, header: route, signed: plain },
    { name: "gap in sequence numbers", seen: { [keyOf(TEST_SENDER)]: 2 }, header: route, signed: plain },
  ];
}

export function envelopeVectors() {
  return {
    note: "TEST-ONLY KEYS from fixed public seeds. `frame` is the envelope exactly as it travels.",
    trusted: [keyOf(TEST_SENDER)],
    vectors: envelopeCases().map((c) => {
      const secret = c.secret ?? TEST_SENDER;
      const sig = sigOver(c.signed, secret);
      const signed = (c as { tamper?: boolean }).tamper ? c.signed.replace("ดี", "ดิ") : c.signed;
      const frame = JSON.stringify({ v: 1, ...c.header, from: keyOf(secret), signed, sig });
      const seen = new MemorySeenSequences();
      for (const [key, seq] of Object.entries(c.seen ?? {})) seen.record(key, seq);
      const result = verify(JSON.parse(frame), new Set([keyOf(TEST_SENDER)]), seen);
      return {
        name: c.name,
        seen: c.seen ?? {},
        frame,
        /** Ed25519 over the UTF-8 of `signed` with the key in `from`, nothing else. */
        signatureValid: verifySignature(fromBase64url(sig), encoder.encode(signed), publicKeyOf(secret)),
        expect: result.ok ? "ok" : result.reason,
      };
    }),
  };
}

export function handshakeVectors() {
  const hubUrl = "wss://hub.example.com";
  const nonce = toBase64url(new Uint8Array(32).map((_, i) => i));
  const otherNonce = toBase64url(new Uint8Array(32).map((_, i) => 255 - i));
  const auth = (url: string, n: string, secret = TEST_MACHINE) => answerChallenge(url, n, secret);
  const good = auth(hubUrl, nonce);
  const cases = [
    { name: "valid", answer: good, valid: true },
    { name: "valid when signed for the same Hub URL written differently", answer: auth("WSS://Hub.Example.com:443/", nonce), valid: true },
    { name: "signed for another Hub", answer: auth("wss://evil.example.com", nonce), valid: false },
    { name: "signed for another nonce", answer: auth(hubUrl, otherNonce), valid: false },
    { name: "signature by another key", answer: { ...good, sig: auth(hubUrl, nonce, TEST_STRANGER).sig }, valid: false },
  ];
  return {
    note: "TEST-ONLY KEYS from fixed public seeds. The Hub is configured with `hubUrl` and sent `nonce`.",
    hubUrl,
    nonce,
    /** What the client signs, as text, for this hubUrl and nonce. */
    signedText: new TextDecoder().decode(handshakeBytes(hubUrl, nonce)),
    vectors: cases.map((c) => ({ name: c.name, frame: JSON.stringify(c.answer), valid: c.valid })),
  };
}

export function hubUrlVectors() {
  const inputs = [
    "wss://hub.example.com",
    "WSS://Hub.Example.COM/",
    "wss://hub.example.com:443",
    "wss://hub.example.com:8443",
    "ws://127.0.0.1:18080/",
    "ws://localhost:80",
    "https://hub.example.com",
    "wss://hub.example.com/connect",
    "wss://hub.example.com?x=1",
    "wss://user:pass@hub.example.com",
    "wss://hub.example.com#frag",
  ];
  return {
    vectors: inputs.map((input) => {
      try {
        return { input, normalized: normalizeHubUrl(input) };
      } catch {
        return { input, error: true };
      }
    }),
  };
}

export const FIXTURES = {
  "schema/envelope-header.schema.json": headerSchema,
  "vectors/envelopes.json": envelopeVectors,
  "vectors/handshakes.json": handshakeVectors,
  "vectors/hub-urls.json": hubUrlVectors,
};

export const render = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
