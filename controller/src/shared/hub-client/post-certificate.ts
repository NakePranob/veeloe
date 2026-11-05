import { ErrorBodySchema, hubHttpUrl, type Certificate } from "@veeloe/protocol";

export type HubAnswer = { ok: true } | { ok: false; code: string };

/** `POST /links` or `/revocations`: the Hub's yes, or its error code (ADR 0065). Unreachable reads as `pairing.hub_unreachable`. */
export async function postCertificate(hub: string, path: "/links" | "/revocations", certificate: Certificate, fetchFn: typeof fetch = fetch): Promise<HubAnswer> {
  try {
    const response = await fetchFn(`${hubHttpUrl(hub)}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(certificate) });
    if (response.ok) return { ok: true };
    const error = ErrorBodySchema.safeParse(((await response.json()) as { error?: unknown } | null)?.error);
    return { ok: false, code: error.success ? error.data.code : "pairing.hub_unreachable" };
  } catch {
    return { ok: false, code: "pairing.hub_unreachable" };
  }
}
