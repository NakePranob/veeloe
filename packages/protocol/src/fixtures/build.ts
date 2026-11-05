import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign, verifySignature } from "../crypto/ed25519";
import { EnvelopeSchema, type Route } from "../envelope/schema";
import { MemorySeenSequences, verify } from "../envelope/verify";
import { createSigner } from "../envelope/sign";
import { answerChallenge, handshakeBytes, normalizeHubUrl } from "../messages/hub-auth";
import { pairingProof, pairingProofText } from "../messages/pairing-claim";
import { buildPairingLink, buildPairingRequest, pairingLinkBytes, pairingRequestBytes, parsePairingLink } from "../messages/pairing-link";
import { revokedWith, signCertificate, verifyCertificate } from "../messages/certificate";
import { buildLinkingLink, linkingProof, linkingProofText } from "../messages/linking";

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
const TEST_NEW_DEVICE = new Uint8Array(32).fill(0x66);

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

/** Bodies every implementation must read the same way: `valid` is whether parseMessage takes it. */
export function messageVectors() {
  const agent = { id: "agent-1", name: "Deployer", provider: "anthropic", model: "claude-sonnet-5-5" };
  const character = { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "ears", decal: "none" };
  const event = { agent: "agent-1", seq: 3, kind: "llm.message", at: 1_800_000_000_000, body: { content: [{ type: "text", text: "สวัสดี" }] } };
  const cases: { name: string; type: string; body: unknown; valid: boolean }[] = [
    { name: "create an Agent", type: "agent.create", body: agent, valid: true },
    { name: "create with a field this build does not know", type: "agent.create", body: { ...agent, mascot: "robot" }, valid: true },
    { name: "create with a Character", type: "agent.create", body: { ...agent, character }, valid: true },
    { name: "create with a Character part this build does not know", type: "agent.create", body: { ...agent, character: { ...character, shell: "orb", glow: true } }, valid: true },
    { name: "create with a Character colour that is not #rrggbb", type: "agent.create", body: { ...agent, character: { ...character, color: "red" } }, valid: false },
    { name: "create with a Character part too long", type: "agent.create", body: { ...agent, character: { ...character, top: "a".repeat(33) } }, valid: false },
    { name: "create with a Character part that is not a lowercase word", type: "agent.create", body: { ...agent, character: { ...character, decal: "<b>" } }, valid: false },
    { name: "create with a Character missing a slot", type: "agent.create", body: { ...agent, character: { color: "#9DC3E6", shell: "dome" } }, valid: false },
    { name: "create with a blank name", type: "agent.create", body: { ...agent, name: "  " }, valid: false },
    { name: "create with no model", type: "agent.create", body: { id: "agent-1", name: "Deployer", provider: "anthropic" }, valid: false },
    { name: "create with an id that is not a plain folder name", type: "agent.create", body: { ...agent, id: "../trust" }, valid: false },
    { name: "list", type: "agent.list", body: {}, valid: true },
    {
      name: "listed, with a Provider that answered and one that did not",
      type: "agent.listed",
      body: { agents: [agent], providers: [{ name: "anthropic", models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }] }, { name: "openrouter", error: "provider.unreachable" }] },
      valid: true,
    },
    { name: "listed, with an Agent that has a Character and one made before Characters", type: "agent.listed", body: { agents: [{ ...agent, character }, { ...agent, id: "agent-2" }], providers: [] }, valid: true },
    { name: "listed with a Character colour that is not #rrggbb", type: "agent.listed", body: { agents: [{ ...agent, character: { ...character, color: "#12345" } }], providers: [] }, valid: false },
    { name: "listed with no providers field", type: "agent.listed", body: { agents: [] }, valid: false },
    { name: "a message in a Task", type: "task.message", body: { agent: "agent-1", id: "msg-1", text: "deploy ให้หน่อย" }, valid: true },
    { name: "an empty message", type: "task.message", body: { agent: "agent-1", id: "msg-1", text: "" }, valid: false },
    { name: "an event", type: "task.event", body: event, valid: true },
    { name: "an event of a kind this build does not know", type: "task.event", body: { ...event, kind: "future.thing" }, valid: true },
    { name: "an event numbered from zero", type: "task.event", body: { ...event, seq: 0 }, valid: false },
    { name: "sync from the start", type: "task.sync", body: { agent: "agent-1", after: 0 }, valid: true },
    { name: "sync from a negative number", type: "task.sync", body: { agent: "agent-1", after: -1 }, valid: false },
    { name: "a page of events", type: "task.events", body: { agent: "agent-1", events: [{ seq: 1, kind: "member.message", at: 1, body: {} }] }, valid: true },
    { name: "an error about an envelope", type: "error", body: { code: "agent.busy", ref: "sig-1" }, valid: true },
    { name: "listed with the Machine's Egress", type: "agent.listed", body: { agents: [agent], providers: [], egress: ["github.com", "*.npmjs.org"] }, valid: true },
    { name: "listed with an Egress entry that is not a domain", type: "agent.listed", body: { agents: [], providers: [], egress: ["10.0.0.1"] }, valid: false },
    { name: "set the Egress", type: "egress.set", body: { egress: ["github.com", "*.npmjs.org"] }, valid: true },
    { name: "set the Egress to nothing", type: "egress.set", body: { egress: [] }, valid: true },
    { name: "set the Egress with a URL", type: "egress.set", body: { egress: ["https://pypi.org/simple"] }, valid: false },
    { name: "set the Egress with localhost", type: "egress.set", body: { egress: ["localhost"] }, valid: false },
    { name: "a claim that names the Member's other keys", type: "pairing.claim", body: { member: "m_1", proof: "p", keys: ["k1", "k2"] }, valid: true },
    { name: "a claim from before other keys", type: "pairing.claim", body: { member: "m_1", proof: "p" }, valid: true },
    { name: "list Tasks", type: "task.list", body: {}, valid: true },
    { name: "listed Tasks", type: "task.listed", body: { tasks: [{ id: "task-1", agent: "agent-1", updated: 1_800_000_000_000 }] }, valid: true },
    { name: "listed Tasks with an Agent id that is not a folder name", type: "task.listed", body: { tasks: [{ id: "task-1", agent: "../x", updated: 1 }] }, valid: false },
    { name: "a handoff", type: "device.handoff", body: { data: "{}", proof: "p" }, valid: true },
    { name: "a handoff with no proof", type: "device.handoff", body: { data: "{}" }, valid: false },
    { name: "linked", type: "device.linked", body: {}, valid: true },
    { name: "set the Egress with more than 100 domains", type: "egress.set", body: { egress: Array.from({ length: 101 }, (_, i) => `d${i}.example.com`) }, valid: false },
  ];
  return { note: "`valid` is whether a receiver accepts the body of an envelope of `type` that verify already accepted.", vectors: cases };
}

/**
 * Certificates every implementation must judge the same way: `valid` is whether
 * the key in `by` really signed exactly this, before asking whether it is trusted.
 */
export function certificateVectors() {
  const common = { workspace: "w_vector", member: "m_vector", at: 1_800_000_000_000 };
  const link = signCertificate({ ...common, type: "device.link", key: keyOf(TEST_NEW_DEVICE), name: "Chrome บน Mac" }, TEST_CONTROLLER);
  const revoke = signCertificate({ ...common, type: "device.revoke", key: keyOf(TEST_CONTROLLER), keep: [keyOf(TEST_NEW_DEVICE)] }, TEST_NEW_DEVICE);
  const resigned = (signed: string, secret: Uint8Array) => ({ signed, sig: sigOver(signed, secret) });
  const cases = [
    { name: "a link", certificate: link },
    { name: "a revocation that keeps one key", certificate: revoke },
    { name: "a link with a field this build does not know", certificate: resigned(link.signed.replace('"v":1,', '"v":1,"hint":"newer",'), TEST_CONTROLLER) },
    { name: "a link to another key, after signing", certificate: { ...link, signed: link.signed.replace(keyOf(TEST_NEW_DEVICE), keyOf(TEST_STRANGER)) } },
    { name: "a link to another Member, after signing", certificate: { ...link, signed: link.signed.replace("m_vector", "m_other") } },
    { name: "a link signed by a key other than its by", certificate: { ...link, sig: sigOver(link.signed, TEST_STRANGER) } },
    { name: "a link with no name", certificate: resigned(link.signed.replace(/"name":"[^"]*",?/, ""), TEST_CONTROLLER) },
    { name: "a revocation with no keep list", certificate: resigned(revoke.signed.replace(/,?"keep":\[[^\]]*\]/, ""), TEST_NEW_DEVICE) },
    { name: "a type this build does not know", certificate: resigned(link.signed.replace("device.link", "device.rename"), TEST_CONTROLLER) },
  ];
  // A tree: A linked B and C, B linked D. Revoking A and keeping C drops A, B and D.
  const links = [
    { key: "B", by: "A" },
    { key: "C", by: "A" },
    { key: "D", by: "B" },
  ];
  return {
    note: "TEST-ONLY KEYS from fixed public seeds. `sig` is Ed25519 over the UTF-8 of `signed`, by the key in its `by`.",
    vectors: cases.map((c) => ({ name: c.name, certificate: c.certificate, valid: verifyCertificate(c.certificate) !== null })),
    fallout: { revoked: "A", links, keep: ["C"], drops: revokedWith("A", links, ["C"]) },
  };
}

/** The QR a new device shows, and the proof on the handoff it waits for. */
export function linkingVectors() {
  const key = keyOf(TEST_NEW_DEVICE);
  const secret = toBase64url(TEST_PAIRING_SECRET);
  const data = JSON.stringify({ workspace: "w_vector", member: "m_vector", machines: [{ id: "machine-1", key: keyOf(TEST_MACHINE), name: "my-mac", hub: "wss://hub.example.com" }], keys: [{ key: keyOf(TEST_CONTROLLER), name: "iPhone" }] });
  return {
    note: "TEST-ONLY KEYS from fixed public seeds.",
    link: buildLinkingLink({ hub: "wss://hub.example.com", key, name: "Chrome บน Mac", secret: TEST_PAIRING_SECRET, expires: 2_000_000_000 }),
    key,
    secret,
    data,
    proofText: linkingProofText(key, data),
    proof: linkingProof({ secret, key, data }),
  };
}

export const FIXTURES = {
  "schema/envelope-header.schema.json": headerSchema,
  "vectors/envelopes.json": envelopeVectors,
  "vectors/handshakes.json": handshakeVectors,
  "vectors/hub-urls.json": hubUrlVectors,
  "vectors/pairings.json": pairingVectors,
  "vectors/messages.json": messageVectors,
  "vectors/certificates.json": certificateVectors,
  "vectors/linkings.json": linkingVectors,
};

export const render = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
