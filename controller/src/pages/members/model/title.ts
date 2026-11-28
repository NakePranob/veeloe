import { publicKeyOf, signCertificate, toBase64url } from "@veeloe/protocol-ts";
import { postCertificate, type HubAnswer } from "../../../shared/hub-client";

/** As long as a title may be: the same 40 the Protocol checks. */
const TITLE_MAX = 40;

/**
 * Changes a Member's title (ADR 0093): an Owner, or the Member themself, signs `member.title` after a fresh
 * authentication; the Hub refuses anyone else and hands it to every device. Empty takes the title away. Null
 * when nobody authenticated.
 */
export async function setTitle(
  authenticate: (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>,
  { hub, workspace, member, title, fetchFn, now = Date.now }: { hub: string; workspace: string; member: string; title: string; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  const sent: { answer?: HubAnswer } = {};
  const done = await authenticate(async (key) => {
    const certificate = signCertificate({ type: "member.title", workspace, member, key: toBase64url(publicKeyOf(key)), title: title.trim().slice(0, TITLE_MAX), at: now() }, key);
    sent.answer = await postCertificate(hub, "/member-titles", certificate, fetchFn);
  });
  return done && sent.answer ? sent.answer : null;
}
