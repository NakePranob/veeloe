import { expect, test } from "bun:test";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, verifySignature } from "../crypto/ed25519";
import { parseFrame } from "../frame";
import { answerChallenge, handshakeBytes, normalizeHubUrl } from "./hub-auth";

const machine = new Uint8Array(32).fill(3); // test-only key
const nonce = toBase64url(new Uint8Array(32).fill(9));

test("Hub URLs that differ only in case, default port or a trailing slash sign the same bytes", () => {
  const same = ["wss://hub.example.com", "WSS://Hub.Example.com/", "wss://hub.example.com:443"];
  for (const url of same) expect(handshakeBytes(url, nonce)).toEqual(handshakeBytes(same[0]!, nonce));
  expect(normalizeHubUrl("ws://127.0.0.1:18080/")).toBe("ws://127.0.0.1:18080");
  expect(normalizeHubUrl("ws://localhost:80")).toBe("ws://localhost");
});

test("different Hubs and different nonces sign different bytes", () => {
  expect(handshakeBytes("wss://hub.example.com", nonce)).not.toEqual(handshakeBytes("wss://evil.example.com", nonce));
  expect(handshakeBytes("wss://hub.example.com:8443", nonce)).not.toEqual(handshakeBytes("wss://hub.example.com", nonce));
  const other = toBase64url(new Uint8Array(32).fill(8));
  expect(handshakeBytes("wss://hub.example.com", nonce)).not.toEqual(handshakeBytes("wss://hub.example.com", other));
});

test("a Hub URL with a path, query, credentials or another scheme is refused", () => {
  for (const url of ["https://hub.example.com", "wss://hub.example.com/connect", "wss://hub.example.com?x=1", "wss://u:p@hub.example.com", "not a url"]) {
    expect(() => normalizeHubUrl(url)).toThrow();
  }
});

test("an answer carries the client's key and a signature the Hub can check", () => {
  const auth = answerChallenge("wss://hub.example.com", nonce, machine);
  expect(auth.key).toBe(toBase64url(publicKeyOf(machine)));
  const ok = verifySignature(fromBase64url(auth.sig), handshakeBytes("wss://hub.example.com", nonce), publicKeyOf(machine));
  expect(ok).toBe(true);
});

test("frames: known types parse, unknown types are skipped, garbage is invalid", () => {
  expect(parseFrame(JSON.stringify({ type: "hub.challenge", v: 1, nonce }))).toMatchObject({ kind: "message", message: { type: "hub.challenge", nonce } });
  expect(parseFrame(JSON.stringify({ type: "hub.ready", machine: "m-1", since: "a newer field" }))).toMatchObject({
    kind: "message",
    message: { type: "hub.ready", machine: "m-1" },
  });
  expect(parseFrame(JSON.stringify({ type: "hub.something-new", x: 1 }))).toEqual({ kind: "unknown", type: "hub.something-new" });
  expect(parseFrame(JSON.stringify({ type: "constructor" }))).toEqual({ kind: "unknown", type: "constructor" });
  expect(parseFrame("{")).toEqual({ kind: "invalid" });
  expect(parseFrame("[]")).toEqual({ kind: "invalid" });
  expect(parseFrame(JSON.stringify({ type: "hub.challenge", v: 1 }))).toEqual({ kind: "invalid" });
});

test("a stream of frames keeps going past one of an unknown type", () => {
  const frames = [JSON.stringify({ type: "hub.future" }), JSON.stringify({ type: "hub.ready", machine: "m-1" })];
  const handled = frames.map(parseFrame).filter((f) => f.kind === "message");
  expect(handled).toHaveLength(1);
});
