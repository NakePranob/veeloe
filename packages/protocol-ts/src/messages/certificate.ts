import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign, verifySignature } from "../crypto/ed25519";

/**
 * Signed apart from any envelope, so it carries no `seq`: a Machine that was off
 * while the signer sent other envelopes still takes it when the Hub hands it over
 * later (ADR 0031). `sig` is Ed25519 over the UTF-8 of `signed`, by the key in its `by`.
 */
export const CertificateSchema = z.looseObject({ signed: z.string().min(1).max(4096), sig: z.string().min(1) });
export type Certificate = z.infer<typeof CertificateSchema>;

const key = z.string().min(1).max(64);
const common = { v: z.literal(1), workspace: z.string().min(1), member: z.string().min(1), key, by: key, at: z.number().int().nonnegative() };

/** `key` is now a Controller of `member`, vouched for by `by`, another of theirs. */
export const DeviceLinkSchema = z.looseObject({ ...common, type: z.literal("device.link"), name: z.string().trim().min(1).max(80) });
/** `key` is no longer one, nor anything it linked except the keys in `keep`. */
export const DeviceRevokeSchema = z.looseObject({ ...common, type: z.literal("device.revoke"), keep: z.array(key).max(100) });
export type DeviceLink = z.infer<typeof DeviceLinkSchema>;
export type DeviceRevoke = z.infer<typeof DeviceRevokeSchema>;
export type Certified = DeviceLink | DeviceRevoke;

const CertifiedSchema = z.discriminatedUnion("type", [DeviceLinkSchema, DeviceRevokeSchema]);

/** The frame the Hub sends after `hub.ready`, and again with each new certificate. In the order they were made. */
export const HubCertificatesSchema = z.looseObject({ type: z.literal("hub.certificates"), certificates: z.array(CertificateSchema) });
export type HubCertificates = z.infer<typeof HubCertificatesSchema>;

const encoder = new TextEncoder();

export function signCertificate(body: Omit<DeviceLink, "v" | "by"> | Omit<DeviceRevoke, "v" | "by">, secretKey: Uint8Array): Certificate {
  const signed = JSON.stringify({ v: 1, ...body, by: toBase64url(publicKeyOf(secretKey)) });
  return { signed, sig: toBase64url(sign(encoder.encode(signed), secretKey)) };
}

/**
 * What the certificate says, when the key it names in `by` really signed it.
 * Whether that key is one to believe is the receiver's question, not this one's.
 * A type this build does not know reads as invalid, so it is skipped (ADR 0023).
 */
export function verifyCertificate(certificate: unknown): Certified | null {
  const parsed = CertificateSchema.safeParse(certificate);
  if (!parsed.success) return null;
  let body: z.infer<typeof CertifiedSchema>;
  try {
    const value = CertifiedSchema.safeParse(JSON.parse(parsed.data.signed));
    if (!value.success) return null;
    body = value.data;
    if (!verifySignature(fromBase64url(parsed.data.sig), encoder.encode(parsed.data.signed), fromBase64url(body.by))) return null;
  } catch {
    return null;
  }
  return body;
}

/**
 * Every key that stops being trusted when `revoked` is: it, and whatever it
 * linked, and so on down, except the keys kept. The Hub, the Runtime and the
 * Controller all work this out the same way.
 */
export function revokedWith(revoked: string, links: readonly { key: string; by: string }[], keep: readonly string[]): string[] {
  const out = [revoked];
  for (let i = 0; i < out.length; i++) {
    for (const link of links) if (link.by === out[i] && !keep.includes(link.key) && !out.includes(link.key)) out.push(link.key);
  }
  return out;
}
