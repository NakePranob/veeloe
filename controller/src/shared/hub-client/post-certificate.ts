import { ErrorBodySchema, hubHttpUrl, InvitationAnswerSchema, type Certificate, type InvitationAnswer, type InvitationRequest, type LinkRequest } from "@veeloe/protocol-ts";

export type HubAnswer = { ok: true } | { ok: false; code: string };

async function post(hub: string, path: string, body: unknown, fetchFn: typeof fetch): Promise<HubAnswer> {
  const answer = await postFor(hub, path, body, fetchFn);
  return answer.ok ? { ok: true } : answer;
}

async function postFor(hub: string, path: string, body: unknown, fetchFn: typeof fetch): Promise<{ ok: true; body: unknown } | { ok: false; code: string }> {
  try {
    const response = await fetchFn(`${hubHttpUrl(hub)}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { ok: true, body: await response.json().catch(() => null) };
    const error = ErrorBodySchema.safeParse(((await response.json()) as { error?: unknown } | null)?.error);
    return { ok: false, code: error.success ? error.data.code : "pairing.hub_unreachable" };
  } catch {
    return { ok: false, code: "pairing.hub_unreachable" };
  }
}

/** `POST /links` or `/revocations`: the Hub's yes, or its error code (ADR 0065). Unreachable reads as `pairing.hub_unreachable`. */
export function postCertificate(hub: string, path: "/links" | "/revocations" | "/invitations" | "/invitations/close" | "/member-removals", certificate: Certificate, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  return post(hub, path, certificate, fetchFn);
}

/** `POST /link-requests`, from a new device the Hub does not know yet: delivered to the device showing the QR, or why not. */
export function postLinkRequest(hub: string, request: LinkRequest, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  return post(hub, "/link-requests", request, fetchFn);
}

/** `POST /members`: a new Member let in through an Invitation, with what is left for their device (ADR 0059). */
export function postMember(hub: string, certificate: Certificate, handoff: { data: string; proof: string }, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  return post(hub, "/members", { certificate, handoff }, fetchFn);
}

/** `POST /invitation-requests`, from a key the Hub does not know yet: still waiting, the hand-off once let in, or why not. */
export async function postInvitationRequest(hub: string, request: InvitationRequest, fetchFn: typeof fetch = fetch): Promise<{ ok: true; answer: InvitationAnswer } | { ok: false; code: string }> {
  const answer = await postFor(hub, "/invitation-requests", request, fetchFn);
  if (!answer.ok) return answer;
  const parsed = InvitationAnswerSchema.safeParse(answer.body);
  return parsed.success ? { ok: true, answer: parsed.data } : { ok: false, code: "pairing.hub_unreachable" };
}
