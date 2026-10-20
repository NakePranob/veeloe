import { expect, test } from "bun:test";
import { HubAuthSchema } from "../messages/hub-auth";
import { fromBase64url } from "../crypto/base64url";
import { verifySignature } from "../crypto/ed25519";
import { MemorySeenSequences, verify } from "../envelope/verify";
import { handshakeBytes } from "../messages/hub-auth";
import { FIXTURES, render } from "./build";

const root = `${import.meta.dir}/../..`;
const update = process.env.UPDATE_FIXTURES === "1";

test.each(Object.entries(FIXTURES))("%s is up to date", async (path, build) => {
  const file = Bun.file(`${root}/${path}`);
  if (update) await Bun.write(file, render(build()));
  expect(await file.text()).toBe(render(build()));
});

test("every envelope vector reaches its expected result", async () => {
  const { trusted, vectors } = await Bun.file(`${root}/vectors/envelopes.json`).json();
  const expects = new Set(vectors.map((v: { expect: string }) => v.expect));
  expect([...expects].sort()).toEqual(["bad-signature", "header-mismatch", "ok", "replayed", "untrusted-key"]);
  for (const v of vectors) {
    const seen = new MemorySeenSequences();
    for (const [key, seq] of Object.entries(v.seen)) seen.record(key, seq as number);
    const result = verify(JSON.parse(v.frame), new Set(trusted), seen);
    expect([v.name, result.ok ? "ok" : result.reason]).toEqual([v.name, v.expect]);
  }
});

test("every handshake vector checks out as expected", async () => {
  const { hubUrl, nonce, signedText, vectors } = await Bun.file(`${root}/vectors/handshakes.json`).json();
  expect(new TextDecoder().decode(handshakeBytes(hubUrl, nonce))).toBe(signedText);
  for (const v of vectors) {
    const answer = HubAuthSchema.parse(JSON.parse(v.frame));
    const ok = verifySignature(fromBase64url(answer.sig), handshakeBytes(hubUrl, nonce), fromBase64url(answer.key));
    expect([v.name, ok]).toEqual([v.name, v.valid]);
  }
});
