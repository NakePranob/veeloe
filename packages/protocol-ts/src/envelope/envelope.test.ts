import { expect, test } from "bun:test";
import { toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign } from "../crypto/ed25519";
import type { Route } from "./schema";
import { createSigner } from "./sign";
import { MemorySeenSequences, verify } from "./verify";

// Test-only keys, from fixed seeds.
const alice = new Uint8Array(32).fill(1);
const mallory = new Uint8Array(32).fill(2);
const aliceKey = toBase64url(publicKeyOf(alice));
const trusted = new Set([aliceKey]);
const forAgent1 = (route: Route) => ("to" in route ? route.to === "agent-1" || route.to === "machine-1" : route.recipients.includes("member-1"));

function signerFrom(secret: Uint8Array, start = 1) {
  let seq = start;
  return createSigner(secret, () => seq++);
}

const message = { type: "task.message", to: "agent-1", task: "task-1", member: "member-1", body: { text: "สวัสดี" } };

test("the signed part is one JSON string copying the routing header and the counter", () => {
  const env = signerFrom(alice, 7)(message);
  expect(env).toMatchObject({ v: 1, type: "task.message", to: "agent-1", task: "task-1", member: "member-1", from: aliceKey });
  expect(JSON.parse(env.signed)).toEqual({ type: "task.message", to: "agent-1", task: "task-1", member: "member-1", seq: 7, body: { text: "สวัสดี" } });
});

test("optional header fields stay out of both header and signed part when absent", () => {
  const env = signerFrom(alice)({ type: "ping", to: "machine-1", body: {} });
  expect("task" in env).toBe(false);
  expect(Object.keys(JSON.parse(env.signed))).toEqual(["type", "to", "seq", "body"]);
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences()).ok).toBe(true);
});

test("a correct envelope verifies, whatever key order or whitespace its bytes use", () => {
  const signed = '{ "body": {"text":"สวัสดี"},\n "seq": 1, "member":"member-1","task":"task-1","to":"agent-1","type":"task.message" }';
  const sig = toBase64url(sign(new TextEncoder().encode(signed), alice));
  const env = { v: 1, type: "task.message", from: aliceKey, to: "agent-1", task: "task-1", member: "member-1", signed, sig };
  const result = verify(env, trusted, forAgent1, new MemorySeenSequences());
  expect(result).toMatchObject({ ok: true, from: aliceKey, signed: { seq: 1, body: { text: "สวัสดี" } } });
});

test("an untrusted sender key is rejected before the signed part is parsed", () => {
  const env = { ...signerFrom(mallory)(message), signed: "not json" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "untrusted-key" });
});

test("an invalid signature is rejected before the signed part is parsed", () => {
  const env = { ...signerFrom(alice)(message), signed: "not json" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "bad-signature" });
});

test("one changed byte in the signed part is rejected", () => {
  const env = signerFrom(alice)(message);
  const tampered = { ...env, signed: env.signed.replace("สวัสดี", "สวัสดิ") };
  expect(verify(tampered, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "bad-signature" });
});

test("a redirected envelope is rejected", () => {
  const env = { ...signerFrom(alice)(message), to: "agent-2" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "header-mismatch" });
});

test("a swapped originating Member is rejected", () => {
  const env = { ...signerFrom(alice)(message), member: "member-2" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "header-mismatch" });
});

test("a changed message type is rejected", () => {
  const env = { ...signerFrom(alice)(message), type: "approval.answer" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "header-mismatch" });
});

test("a header field the signed part lacks is rejected", () => {
  const env = { ...signerFrom(alice)({ type: "ping", to: "machine-1", body: {} }), task: "task-9" };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "header-mismatch" });
});

test("sequence numbers must go up per sender key; gaps are fine", () => {
  const seen = new MemorySeenSequences();
  const signer = signerFrom(alice, 5);
  const first = signer(message);
  expect(verify(first, trusted, forAgent1, seen).ok).toBe(true);
  expect(verify(first, trusted, forAgent1, seen)).toEqual({ ok: false, reason: "replayed" });

  const older = createSigner(alice, () => 3)(message);
  expect(verify(older, trusted, forAgent1, seen)).toEqual({ ok: false, reason: "replayed" });

  const later = createSigner(alice, () => 42)(message);
  expect(verify(later, trusted, forAgent1, seen).ok).toBe(true);
  expect(seen.last(aliceKey)).toBe(42);
});

test("a rejected envelope does not move the counter", () => {
  const seen = new MemorySeenSequences();
  const bad = { ...createSigner(alice, () => 9)(message), to: "agent-2" };
  expect(verify(bad, trusted, forAgent1, seen).ok).toBe(false);
  expect(seen.last(aliceKey)).toBeUndefined();
});

test("unknown fields in the header and in the signed part are accepted and ignored", () => {
  const signed = JSON.stringify({ ...message, seq: 1, priority: "high" });
  const sig = toBase64url(sign(new TextEncoder().encode(signed), alice));
  const { body: _, ...routing } = message;
  const env = { v: 1, ...routing, from: aliceKey, signed, sig, hint: "from a newer sender" };
  const result = verify(env, trusted, forAgent1, new MemorySeenSequences());
  expect(result.ok).toBe(true);
});

test("a frame that is not an envelope is malformed", () => {
  for (const env of [null, "text", { v: 2 }, { ...signerFrom(alice)(message), v: 2 }]) {
    expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "malformed" });
  }
});

test("signed bytes that are not the expected shape are malformed, even when signed", () => {
  const signed = JSON.stringify({ type: "task.message", to: "agent-1", seq: 0, body: {} });
  const sig = toBase64url(sign(new TextEncoder().encode(signed), alice));
  const env = { v: 1, type: "task.message", to: "agent-1", from: aliceKey, signed, sig };
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "malformed" });
});

const toMembers = { type: "task.event", recipients: ["member-1", "member-2"], task: "task-1", body: {} };

test("a message to Members carries the recipient list in both header and signed part, and no destination", () => {
  const env = signerFrom(alice)(toMembers);
  expect(env.recipients).toEqual(["member-1", "member-2"]);
  expect("to" in env).toBe(false);
  expect(JSON.parse(env.signed).recipients).toEqual(["member-1", "member-2"]);
  expect(verify(env, trusted, forAgent1, new MemorySeenSequences()).ok).toBe(true);
});

test("an envelope with both routes or neither is malformed", () => {
  const env = signerFrom(alice)(message);
  const { to: _, ...noRoute } = env;
  for (const bad of [{ ...env, recipients: ["member-1"] }, noRoute, { ...noRoute, recipients: [] }]) {
    expect(verify(bad, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "malformed" });
  }
});

test("a changed recipient or a changed order is a header mismatch", () => {
  const env = signerFrom(alice)(toMembers);
  for (const recipients of [["member-1", "member-3"], ["member-2", "member-1"], ["member-1"]]) {
    expect(verify({ ...env, recipients }, trusted, forAgent1, new MemorySeenSequences())).toEqual({ ok: false, reason: "header-mismatch" });
  }
});

test("a validly signed envelope meant for someone else is rejected and leaves the counter alone", () => {
  const seen = new MemorySeenSequences();
  for (const route of [{ to: "agent-2" }, { recipients: ["member-2"] }]) {
    const env = createSigner(alice, () => 9)({ type: "task.message", ...route, body: {} });
    expect(verify(env, trusted, forAgent1, seen)).toEqual({ ok: false, reason: "not-addressed" });
  }
  expect(seen.last(aliceKey)).toBeUndefined();
  expect(verify(createSigner(alice, () => 2)(message), trusted, forAgent1, seen).ok).toBe(true);
});

test("no rejection moves the counter", () => {
  const seen = new MemorySeenSequences();
  const env = createSigner(alice, () => 9)(message);
  const bad = [{ ...env, v: 2 }, createSigner(mallory, () => 9)(message), { ...env, sig: env.sig.replace(/^./, (c) => (c === "A" ? "B" : "A")) }, { ...env, member: "member-2" }, createSigner(alice, () => 9)({ ...message, to: "agent-2" })];
  for (const frame of bad) expect(verify(frame, trusted, forAgent1, seen).ok).toBe(false);
  expect(seen.last(aliceKey)).toBeUndefined();
});
