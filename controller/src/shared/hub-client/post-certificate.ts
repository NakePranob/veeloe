import { ErrorBodySchema, hubHttpUrl, type Certificate, type LinkRequest } from "@veeloe/protocol";

export type HubAnswer = { ok: true } | { ok: false; code: string };

async function post(hub: string, path: string, body: unknown, fetchFn: typeof fetch): Promise<HubAnswer> {
  try {
    const response = await fetchFn(`${hubHttpUrl(hub)}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const error = ErrorBodySchema.safeParse(((await response.json()) as { error?: unknown } | null)?.error);
    return { ok: false, code: error.success ? error.data.code : "pairing.hub_unreachable" };
  } catch {
    return { ok: false, code: "pairing.hub_unreachable" };
  }
}

/** `POST /links` or `/revocations`: the Hub's yes, or its error code (ADR 0065). Unreachable reads as `pairing.hub_unreachable`. */
export function postCertificate(hub: string, path: "/links" | "/revocations", certificate: Certificate, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  return post(hub, path, certificate, fetchFn);
}

/** `POST /link-requests`, from a new device the Hub does not know yet: delivered to the device showing the QR, or why not. */
export function postLinkRequest(hub: string, request: LinkRequest, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  return post(hub, "/link-requests", request, fetchFn);
}
