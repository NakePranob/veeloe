import { expect, test } from "bun:test";
import { checkLinkingProof, linkRequestProof, publicKeyOf, shortCode, toBase64url, verifyCertificate } from "@veeloe/protocol-ts";
import type { Machine } from "../../../entities/machine";
import { draftInvitation, letIn, takeRequest } from "./invite";

// TEST-ONLY KEYS from fixed seeds.
const inviter = new Uint8Array(32).fill(0x44);
const joiner = toBase64url(publicKeyOf(new Uint8Array(32).fill(0x66)));
const authenticate = async (use: (key: Uint8Array) => Promise<void>) => {
  await use(inviter);
  return true;
};
const machine = (id: string, hub = "wss://hub.example.com"): Machine => ({ id, public_key: `key-${id}`, name: id, hub_url: hub, workspace_id: "w_1", member_id: "m_owner", paired_at: 1, egress: "[]" });

test("only a request whose proof matches the secret is taken, once per key, while the link lasts", () => {
  const { link } = draftInvitation({ hub: "wss://hub.example.com", ownKey: toBase64url(publicKeyOf(inviter)), from: "Pang", hours: 24, now: () => 1_000 });
  const proof = linkRequestProof({ secret: link.secret, id: link.id, key: joiner, name: "Kai" });
  const request = { type: "hub.invitation_request" as const, invitation: link.id, key: joiner, name: " Kai ", proof };
  // The name is what was proved; the trimmed one is what is shown.
  expect(takeRequest(link, { ...request, name: "Kai" }, [], 2_000)).toEqual({ key: joiner, name: "Kai", code: shortCode(joiner) });
  // A Hub that swaps the key, or makes a request up, has no matching proof.
  expect(takeRequest(link, { ...request, name: "Kai", key: toBase64url(publicKeyOf(new Uint8Array(32).fill(0x67))) }, [], 2_000)).toBeNull();
  expect(takeRequest(link, { ...request, name: "Kai", invitation: "other" }, [], 2_000)).toBeNull();
  // A key let in already, or a link past its time, asks no more.
  expect(takeRequest(link, { ...request, name: "Kai" }, [{ key: joiner, member: "m_x", name: "Kai" }], 2_000)).toBeNull();
  expect(takeRequest(link, { ...request, name: "Kai" }, [], (link.expires + 1) * 1000)).toBeNull();
});

test("letting someone in signs a new Member for their key, leaves a hand-off only their key can check, and sends each Grant to its Machine", async () => {
  const { link } = draftInvitation({ hub: "wss://hub.example.com", ownKey: toBase64url(publicKeyOf(inviter)), from: "Pang", hours: 24 });
  const posted: { path: string; body: { certificate: unknown; handoff: { data: string; proof: string } } }[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    posted.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const sent: string[] = [];
  const machines = [machine("mac"), machine("other"), machine("far", "wss://elsewhere.example.com")];
  const result = await letIn(authenticate, {
    link,
    ask: { key: joiner, name: "Kai", code: shortCode(joiner) },
    machine: machines[0],
    machines,
    grants: [
      { machine: "mac", agent: "a1", level: "use" },
      { machine: "gone", agent: "a2", level: "approve" },
    ],
    setGrant: (on, body) => {
      sent.push(`${on.id}:${body.agent}:${body.member}:${body.level}`);
      return true;
    },
    fetchFn,
  });
  if (!result) throw new Error("not let in");
  expect(result.answer).toEqual({ ok: true });
  expect(posted.map((p) => p.path)).toEqual(["/members"]);
  const certificate = verifyCertificate(posted[0].body.certificate);
  expect(certificate).toMatchObject({ type: "member.add", workspace: "w_1", member: result.member, key: joiner, name: "Kai", invitation: link.id });
  const { data, proof } = posted[0].body.handoff;
  expect(checkLinkingProof({ secret: link.secret, key: joiner, data }, proof)).toBe(true);
  // Only the Machines its Grants are on, on the link's Hub.
  expect(JSON.parse(data).machines.map((m: { id: string }) => m.id)).toEqual(["mac"]);
  expect(sent).toEqual([`mac:a1:${result.member}:use`]);
  expect(result.unsent).toEqual([{ machine: "gone", agent: "a2", level: "approve" }]);
});
