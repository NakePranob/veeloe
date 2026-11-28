import { expect, test } from "bun:test";
import { publicKeyOf, toBase64url, verifyCertificate } from "@veeloe/protocol-ts";
import { removeMember } from "./remove";

// TEST-ONLY KEY from a fixed seed.
const owner = new Uint8Array(32).fill(0x44);

test("removing signs member.remove with the Owner's own key and posts it, and nothing goes without authenticating", async () => {
  const posted: { path: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    posted.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const answer = await removeMember(async (use) => (await use(owner), true), { hub: "wss://hub.example.com", workspace: "w_1", member: "m_kai", fetchFn });
  expect(answer).toEqual({ ok: true });
  expect(posted[0].path).toBe("/member-removals");
  expect(verifyCertificate(posted[0].body)).toMatchObject({ type: "member.remove", workspace: "w_1", member: "m_kai", key: toBase64url(publicKeyOf(owner)), by: toBase64url(publicKeyOf(owner)) });
  expect(await removeMember(async () => false, { hub: "wss://hub.example.com", workspace: "w_1", member: "m_kai", fetchFn })).toBeNull();
  expect(posted).toHaveLength(1);
});
