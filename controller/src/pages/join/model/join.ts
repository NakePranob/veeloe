import { checkLinkingProof, HandoffDataSchema, linkRequestProof, parseInvitationLink, publicKeyOf, shortCode, toBase64url, type HandoffData, type InvitationLink } from "@veeloe/protocol-ts";
import { postInvitationRequest } from "../../../shared/hub-client";

const linkProblem = { malformed: "invitation.link_malformed", expired: "invitation.link_expired" } as const;

/** An invitation link opened or pasted on this device. It names the Hub, so this device asks for none. */
export function readInvitation(text: string, now = Date.now()): { ok: true; link: InvitationLink } | { ok: false; code: string } {
  const parsed = parseInvitationLink(text.trim(), now);
  return parsed.ok ? parsed : { ok: false, code: linkProblem[parsed.reason] };
}

/** The code this device shows, for the inviter to compare with theirs before letting it in (ADR 0059). */
export function ownCode(secretKey: Uint8Array) {
  return shortCode(toBase64url(publicKeyOf(secretKey)));
}

export type JoinResult = { ok: true; data: HandoffData } | { ok: false; code: string };

/**
 * Asks in, again and again, until the inviter lets this key in and the Hub answers with what they left: only a
 * hand-off whose proof matches the link's secret and this key counts, so the Hub cannot make one up. It ends
 * when the Invitation closes on this key, or the link runs out.
 */
export function askToJoin({ link, name, secretKey, retryMs = 3000, fetchFn, now = Date.now }: { link: InvitationLink; name: string; secretKey: Uint8Array; retryMs?: number; fetchFn?: typeof fetch; now?: () => number }) {
  const key = toBase64url(publicKeyOf(secretKey));
  const chosen = name.trim();
  const request = { invitation: link.id, key, name: chosen, proof: linkRequestProof({ secret: link.secret, id: link.id, key, name: chosen }) };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const done = new Promise<JoinResult>((resolve) => {
    const finish = (result: JoinResult) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      resolve(result);
    };
    stop = () => finish({ ok: false, code: "invitation.stopped" });
    const once = async () => {
      if (stopped) return;
      if (now() > link.expires * 1000) return finish({ ok: false, code: "invitation.link_expired" });
      const answer = await postInvitationRequest(link.hub, request, fetchFn);
      if (!answer.ok) {
        // The Hub out of reach is worth another try; an Invitation closed on this key is the end.
        if (answer.code !== "pairing.hub_unreachable") return finish({ ok: false, code: answer.code });
      } else if (answer.answer.handoff) {
        const { data, proof } = answer.answer.handoff;
        if (checkLinkingProof({ secret: link.secret, key, data }, proof)) {
          try {
            const value = HandoffDataSchema.safeParse(JSON.parse(data));
            if (value.success) return finish({ ok: true, data: value.data });
          } catch {
            // Not one: keep waiting for one that is.
          }
        }
      }
      if (!stopped) timer = setTimeout(() => void once(), retryMs);
    };
    void once();
  });
  return { done, stop: () => stop() };
}
