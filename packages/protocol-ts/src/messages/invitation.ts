import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { fromBase64url } from "../crypto/base64url";
import { normalizeHubUrl } from "./hub-auth";
import { PAIRING_CLOCK_SKEW_SECONDS } from "./pairing-link";

const PREFIX = "veeloe://invite?";

/**
 * What the person inviting sends, by chat or QR (ADR 0059): the Hub, which Invitation, the inviter's key and
 * name, and a secret the Hub never sees. Not signed: it travels outside the Hub, and the inviter still
 * compares a short code before letting anyone in.
 */
export type InvitationLink = {
  hub: string;
  /** Random 128 bits, base64url. */
  id: string;
  /** Random 256 bits, base64url. Only the inviter and whoever holds the link know it. */
  secret: string;
  /** The inviter's public key, base64url: whose live connection a request goes to, and who signs the hand-off. */
  by: string;
  /** The inviter's name, as shown to whoever opens the link. */
  from: string;
  /** Unix seconds. */
  expires: number;
};

export function buildInvitationLink(link: InvitationLink): string {
  return `${PREFIX}hub=${encodeURIComponent(normalizeHubUrl(link.hub))}&id=${link.id}&secret=${link.secret}&by=${link.by}&from=${encodeURIComponent(link.from)}&exp=${link.expires}`;
}

export type ParsedInvitationLink = { ok: true; link: InvitationLink } | { ok: false; reason: "malformed" | "expired" };

const b64 = /^[A-Za-z0-9_-]+$/;

export function parseInvitationLink(text: string, nowMs: number): ParsedInvitationLink {
  if (!text.startsWith(PREFIX)) return { ok: false, reason: "malformed" };
  const fields = new Map(text.slice(PREFIX.length).split("&").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)] as const));
  const [id, secret, by, exp] = [fields.get("id"), fields.get("secret"), fields.get("by"), fields.get("exp")];
  if (!id || !secret || !by || !exp || ![id, secret, by].every((part) => b64.test(part)) || !/^\d+$/.test(exp)) return { ok: false, reason: "malformed" };
  let hub: string;
  let from: string;
  try {
    if (fromBase64url(id).length !== 16 || fromBase64url(secret).length !== 32 || fromBase64url(by).length !== 32) return { ok: false, reason: "malformed" };
    hub = normalizeHubUrl(decodeURIComponent(fields.get("hub") ?? ""));
    from = decodeURIComponent(fields.get("from") ?? "").trim();
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (from.length < 1 || from.length > 80) return { ok: false, reason: "malformed" };
  const expires = Number(exp);
  if (expires + PAIRING_CLOCK_SKEW_SECONDS < nowMs / 1000) return { ok: false, reason: "expired" };
  return { ok: true, link: { hub, id, secret, by, from, expires } };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Six characters both sides show and compare before the inviter lets a key in (ADR 0059): from the
 * SHA-256 of the key, so a Hub that swapped the key cannot keep the code. 30 bits, Crockford base32.
 */
export function shortCode(key: string): string {
  const hash = sha256(fromBase64url(key));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of hash) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 6) {
      out += CROCKFORD[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 6) break;
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

const base64url = z.string().regex(b64).max(64);
const request = { invitation: base64url, key: base64url, name: z.string().min(1).max(80), proof: base64url };

/**
 * Whoever opened the link → Hub, `POST /invitation-requests`, again and again until let in. `proof` is
 * `linkRequestProof` under the link's secret, with the Invitation's id as `id`. Unauthenticated: the Hub
 * does not know this key yet.
 */
export const InvitationRequestSchema = z.looseObject(request);
export type InvitationRequest = z.infer<typeof InvitationRequestSchema>;

/** Hub → the inviter's live connection: a request as posted. Unsigned, so only `proof` makes it worth reading. */
export const HubInvitationRequestSchema = z.looseObject({ type: z.literal("hub.invitation_request"), ...request });
export type HubInvitationRequest = z.infer<typeof HubInvitationRequestSchema>;

/**
 * Hub → whoever asked, once the inviter let them in: the hand-off the inviter left, `data` being
 * HandoffData as JSON and `proof` `linkingProof` under the link's secret. Before that: `{ waiting: true }`.
 */
export const InvitationAnswerSchema = z.looseObject({ handoff: z.looseObject({ data: z.string().min(1).max(100_000), proof: base64url }).optional(), waiting: z.literal(true).optional() });
export type InvitationAnswer = z.infer<typeof InvitationAnswerSchema>;
