import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign, verifySignature } from "../crypto/ed25519";
import { EnvelopeSchema, type Route } from "../envelope/schema";
import { MemorySeenSequences, verify } from "../envelope/verify";
import { createSigner } from "../envelope/sign";
import { answerChallenge, handshakeBytes, normalizeHubUrl } from "../messages/hub-auth";
import { pairingProof, pairingProofText } from "../messages/pairing-claim";
import { buildPairingLink, buildPairingRequest, pairingLinkBytes, pairingRequestBytes, parsePairingLink } from "../messages/pairing-link";

// The files every implementation checks itself against (Go included): the
// header's JSON Schema and the test vectors. Rebuild them with
// `bun run --cwd packages/protocol fixtures`.
//
// TEST-ONLY KEYS. Every secret below is a fixed, public seed. Never use one
// outside a test.
const TEST_SENDER = new Uint8Array(32).fill(0x11);
const TEST_STRANGER = new Uint8Array(32).fill(0x22);
const TEST_MACHINE = new Uint8Array(32).fill(0x33);
const TEST_CONTROLLER = new Uint8Array(32).fill(0x44);
const TEST_PAIRING_SECRET = new Uint8Array(32).fill(0x55);

const encoder = new TextEncoder();
const keyOf = (secret: Uint8Array) => toBase64url(publicKeyOf(secret));
const sigOver = (text: string, secret: Uint8Array) => toBase64url(sign(encoder.encode(text), secret));

/** Who the receiver in the vectors is: what it hosts, and whose Controller it is. */
const SELF = { destinations: ["agent-1"], member: "member-1" };

export function isForSelf(self: typeof SELF) {
  return (route: Route) => ("to" in route ? self.destinations.includes(route.to) : route.recipients.includes(self.member));
}

export function headerSchema() {
  return z.toJSONSchema(EnvelopeSchema);
}

type EnvelopeCase = { name: string; seen?: Record<string, number>; header: Record<string, unknown>; signed: string; secret?: Uint8Array };

function envelopeCases(): EnvelopeCase[] {
  const route = { type: "task.message", to: "agent-1", task: "task-1", member: "member-1" };
  const body = { text: "สวัสดี \"ครับ\" \\ bell:\u0007 tab:\t" };
  const plain = JSON.stringify({ ...route, seq: 8, body });
  const members = { type: "task.event", recipients: ["member-1", "member-2"], task: "task-1" };
  const toMembers = JSON.stringify({ ...members, seq: 8, body });
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
    { name: "valid, to a recipient list", header: members, signed: toMembers },
    { name: "changed recipient", header: { ...members, recipients: ["member-1", "member-3"] }, signed: toMembers },
    { name: "changed order of recipients", header: { ...members, recipients: ["member-2", "member-1"] }, signed: toMembers },
    { name: "both a destination and recipients", header: { ...route, recipients: ["member-1"] }, signed: JSON.stringify({ ...route, recipients: ["member-1"], seq: 8, body }) },
    { name: "no route", header: { type: "task.event" }, signed: JSON.stringify({ type: "task.event", seq: 8, body }) },
    { name: "empty recipient list", header: { type: "task.event", recipients: [] }, signed: JSON.stringify({ type: "task.event", recipients: [], seq: 8, body }) },
    { name: "signed part that is not the expected shape", header: route, signed: JSON.stringify({ ...route, seq: 0, body }) },
    { name: "signed for another destination, unchanged", header: { ...route, to: "agent-2" }, signed: JSON.stringify({ ...route, to: "agent-2", seq: 8, body }) },
    { name: "recipient list leaves out this Member", header: { ...members, recipients: ["member-2"] }, signed: JSON.stringify({ ...members, recipients: ["member-2"], seq: 8, body }) },
  ];
}

export function envelopeVectors() {
  return {
    note: "TEST-ONLY KEYS from fixed public seeds. `frame` is the envelope exactly as it travels.",
    trusted: [keyOf(TEST_SENDER)],
    self: SELF,
    vectors: envelopeCases().map((c) => {
      const secret = c.secret ?? TEST_SENDER;
      const sig = sigOver(c.signed, secret);
      const signed = (c as { tamper?: boolean }).tamper ? c.signed.replace("ดี", "ดิ") : c.signed;
      const frame = JSON.stringify({ v: 1, ...c.header, from: keyOf(secret), signed, sig });
      const seen = new MemorySeenSequences();
      for (const [key, seq] of Object.entries(c.seen ?? {})) seen.record(key, seq);
      const result = verify(JSON.parse(frame), new Set([keyOf(TEST_SENDER)]), isForSelf(SELF), seen);
      return {
        name: c.name,
        seen: c.seen ?? {},
        frame,
        /** Whether the header names exactly one route, which is all the Hub checks. */
        routable: EnvelopeSchema.safeParse(JSON.parse(frame)).success,
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
    /** The frames the Hub writes, byte for byte: `ready` for a Machine, then for a Controller. */
    ready: [JSON.stringify({ type: "hub.ready", machine: "machine-1" }), JSON.stringify({ type: "hub.ready", member: "member-1" })],
    error: JSON.stringify({ type: "hub.error", code: "hub.machine_offline", ref: "sig-1" }),
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
    "ws://localhost:080",
    "ws://localhost:08080",
    "ws://[::1]:8080",
    "wss://[2001:DB8:0:0:0:0:0:1]",
    "wss://[::1]:443",
    "wss://ไทย.example.com",
    "wss://hub.example.com?",
    "wss://hub.example.com#",
    "wss://:8443",
    "wss://[::1%25en0]",
    "wss://hub.example.com:70000",
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

export function pairingVectors() {
  const hubUrl = "wss://hub.example.com";
  const expires = 2_000_000_000;
  const member = "m_vector";
  const link = buildPairingLink({ hub: hubUrl, machineSecretKey: TEST_MACHINE, secret: TEST_PAIRING_SECRET, expires });
  const parsed = parsePairingLink(link, 0);
  if (!parsed.ok) throw new Error(parsed.reason);
  const request = buildPairingRequest(parsed.link, TEST_CONTROLLER);
  const machine = keyOf(TEST_MACHINE);
  const controller = keyOf(TEST_CONTROLLER);
  const secret = toBase64url(TEST_PAIRING_SECRET);
  const proof = pairingProof({ secret, machine, controller, member });
  const claim = createSigner(TEST_CONTROLLER, () => 1)({ type: "pairing.claim", to: "machine-1", body: { member, proof } });
  const done = createSigner(TEST_MACHINE, () => 1)({ type: "pairing.done", recipients: [member], body: { name: "my-mac" } });
  const stranger = (bytes: Uint8Array) => toBase64url(sign(bytes, TEST_STRANGER));
  return {
    note: "TEST-ONLY KEYS from fixed public seeds. The Hub is configured with `hubUrl`, and `now` is the time to check at, in Unix seconds.",
    hubUrl,
    now: expires - 60,
    expires,
    skewSeconds: 120,
    /** The bytes each side signs, and the text the proof is the HMAC of, as text. */
    linkSignedText: new TextDecoder().decode(pairingLinkBytes(hubUrl, machine, expires)),
    requestSignedText: new TextDecoder().decode(pairingRequestBytes(hubUrl, machine, controller, expires)),
    proofText: pairingProofText({ machine, controller, member }),
    secret,
    member,
    proof,
    link,
    claim: JSON.stringify(claim),
    done: JSON.stringify(done),
    requests: [
      { name: "valid", request, valid: true },
      { name: "a Machine signature by another key", request: { ...request, machineSig: stranger(pairingLinkBytes(hubUrl, machine, expires)) }, valid: false },
      { name: "a Machine signature for another expiry", request: { ...request, expires: expires + 1000 }, valid: false },
      { name: "a Controller signature by another key", request: { ...request, controllerSig: stranger(pairingRequestBytes(hubUrl, machine, controller, expires)) }, valid: false },
      {
        name: "a Controller signature for another Hub",
        request: { ...request, controllerSig: toBase64url(sign(pairingRequestBytes("wss://evil.example.com", machine, controller, expires), TEST_CONTROLLER)) },
        valid: false,
      },
    ],
  };
}

export const FIXTURES = {
  "schema/envelope-header.schema.json": headerSchema,
  "vectors/envelopes.json": envelopeVectors,
  "vectors/handshakes.json": handshakeVectors,
  "vectors/hub-urls.json": hubUrlVectors,
  "vectors/pairings.json": pairingVectors,
};

export const render = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
