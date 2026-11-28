import { expect, test } from "bun:test";
import { buildInvitationLink, linkingProof, publicKeyOf, toBase64url, type InvitationLink } from "@veeloe/protocol-ts";
import { askToJoin, readInvitation } from "./join";

// TEST-ONLY KEYS from fixed seeds.
const secretKey = new Uint8Array(32).fill(0x66);
const key = toBase64url(publicKeyOf(secretKey));
const link: InvitationLink = {
  hub: "wss://hub.example.com",
  id: toBase64url(new Uint8Array(16).fill(1)),
  secret: toBase64url(new Uint8Array(32).fill(2)),
  by: toBase64url(publicKeyOf(new Uint8Array(32).fill(0x44))),
  from: "Pang",
  expires: 2_000_000_000,
};
const data = JSON.stringify({ workspace: "w_1", member: "m_kai", machines: [{ id: "mac", key: "k", name: "mac", hub: link.hub }], keys: [] });

function hub(answers: unknown[]) {
  return (async () => new Response(JSON.stringify(answers.shift() ?? { waiting: true }), { status: 200 })) as unknown as typeof fetch;
}

test("a link reads back, and a bent or expired one says why", () => {
  expect(readInvitation(buildInvitationLink(link), 1_900_000_000_000)).toEqual({ ok: true, link });
  expect(readInvitation("veeloe://invite?id=x", 0)).toEqual({ ok: false, code: "invitation.link_malformed" });
  expect(readInvitation(buildInvitationLink(link), 2_100_000_000_000)).toEqual({ ok: false, code: "invitation.link_expired" });
});

test("the wait ends on a hand-off made with the link's secret for this key, and not on one the Hub made up", async () => {
  const forged = { handoff: { data, proof: linkingProof({ secret: toBase64url(new Uint8Array(32).fill(9)), key, data }) } };
  const real = { handoff: { data, proof: linkingProof({ secret: link.secret, key, data }) } };
  const wait = askToJoin({ link, name: "Kai", secretKey, retryMs: 1, fetchFn: hub([{ waiting: true }, forged, real]), now: () => 1_900_000_000_000 });
  const result = await wait.done;
  expect(result).toEqual({ ok: true, data: JSON.parse(data) });
});

test("an Invitation that closes on this key ends the wait with its code", async () => {
  const closed = (async () => new Response(JSON.stringify({ error: { code: "hub.invitation_closed", message: "closed" } }), { status: 410 })) as unknown as typeof fetch;
  const result = await askToJoin({ link, name: "Kai", secretKey, retryMs: 1, fetchFn: closed, now: () => 1_900_000_000_000 }).done;
  expect(result).toEqual({ ok: false, code: "hub.invitation_closed" });
});
