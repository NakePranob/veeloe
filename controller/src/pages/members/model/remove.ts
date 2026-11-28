import { signCertificate, toBase64url, publicKeyOf } from "@veeloe/protocol-ts";
import { postCertificate, type HubAnswer } from "../../../shared/hub-client";

/**
 * Takes a Member out of the Workspace (ADR 0059): an Owner signs `member.remove` after a fresh
 * authentication; the Hub cuts their keys and every Machine drops them and their Grants. Null when
 * the Owner did not authenticate.
 */
export async function removeMember(
  authenticate: (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>,
  { hub, workspace, member, fetchFn, now = Date.now }: { hub: string; workspace: string; member: string; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  const sent: { answer?: HubAnswer } = {};
  const done = await authenticate(async (key) => {
    const certificate = signCertificate({ type: "member.remove", workspace, member, key: toBase64url(publicKeyOf(key)), at: now() }, key);
    sent.answer = await postCertificate(hub, "/member-removals", certificate, fetchFn);
  });
  return done && sent.answer ? sent.answer : null;
}
