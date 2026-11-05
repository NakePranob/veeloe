import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { normalizeHubUrl } from "./hub-auth";
import { PAIRING_CLOCK_SKEW_SECONDS } from "./pairing-link";

/** How long the QR on the device already in the Workspace is good for. */
export const LINKING_TTL_SECONDS = 600;

const PREFIX = "veeloe://link?";
const encoder = new TextEncoder();

/**
 * What the device already in the Workspace shows, as Pairing's QR does: the Hub it
 * is on, so the new device never asks for one (ADR 0013). Not signed: it goes from
 * that screen into the new device's camera, or is pasted there, so no Hub stands
 * between them. The Hub learns `to` and `id`, which it can do nothing with alone;
 * never `secret`.
 */
export type LinkingLink = {
  /** The Hub URL in normal form. */
  hub: string;
  /** The showing device's public key, base64url: whose live connection the Hub hands the request to. */
  to: string;
  /** Random 128 bits, base64url: which QR a request answers. */
  id: string;
  /** The random 256-bit secret, base64url. Never leaves the two devices. */
  secret: string;
  /** Unix seconds. */
  expires: number;
};

export function buildLinkingLink({ hub, to, id, secret, expires }: Omit<LinkingLink, "secret"> & { secret: Uint8Array }): string {
  return `${PREFIX}hub=${encodeURIComponent(normalizeHubUrl(hub))}&to=${to}&id=${id}&secret=${toBase64url(secret)}&exp=${expires}`;
}

export type ParsedLinkingLink = { ok: true; link: LinkingLink } | { ok: false; reason: "malformed" | "expired" };

function decodedLength(text: string): number | undefined {
  try {
    return fromBase64url(text).length;
  } catch {
    return undefined;
  }
}

/** Reads what was scanned, opened or pasted on the new device. */
export function parseLinkingLink(text: string, nowMs: number): ParsedLinkingLink {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return { ok: false, reason: "malformed" };
  const fields = new Map<string, string>();
  for (const pair of trimmed.slice(PREFIX.length).split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) fields.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const { to, id, secret, exp } = Object.fromEntries(fields);
  if (!to || !id || !secret || !exp || !/^[1-9][0-9]{0,14}$/.test(exp)) return { ok: false, reason: "malformed" };
  if (decodedLength(to) !== 32 || decodedLength(id) !== 16 || decodedLength(secret) !== 32) return { ok: false, reason: "malformed" };
  let hub: string;
  try {
    hub = normalizeHubUrl(decodeURIComponent(fields.get("hub") ?? ""));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const expires = Number(exp);
  if (expires + PAIRING_CLOCK_SKEW_SECONDS < nowMs / 1000) return { ok: false, reason: "expired" };
  return { ok: true, link: { hub, to, id, secret, expires } };
}

function hmacOf(secret: string, text: string): string {
  return toBase64url(hmac(sha256, fromBase64url(secret), encoder.encode(text)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** `name` goes last: `id` and `key` are base64url, so no name can pass for another split. */
export function linkRequestProofText(id: string, key: string, name: string): string {
  return `veeloe-link-request/1\n${id}\n${key}\n${name}`;
}

/**
 * HMAC-SHA256 keyed by the secret in the QR, over the new device's key and name.
 * The Hub carries the request but cannot swap the key for one of its own, nor
 * make a request up: it never saw the secret.
 */
export function linkRequestProof({ secret, id, key, name }: { secret: string; id: string; key: string; name: string }): string {
  return hmacOf(secret, linkRequestProofText(id, key, name));
}

export function checkLinkRequestProof(input: { secret: string; id: string; key: string; name: string }, proof: string): boolean {
  return same(linkRequestProof(input), proof);
}

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/).max(64);
const request = { id: base64url, key: base64url, name: z.string().min(1).max(80), proof: base64url };

/** New device → Hub, `POST /link-requests`. Unauthenticated, since the Hub does not know this key yet: `proof` is the check, at the other end. */
export const LinkRequestSchema = z.looseObject({ to: base64url, ...request });
export type LinkRequest = z.infer<typeof LinkRequestSchema>;

/** Hub → the live connection of `to`: the request as posted, less `to`. Unsigned, so only `proof` makes it worth reading. */
export const HubLinkRequestSchema = z.looseObject({ type: z.literal("hub.link_request"), ...request });
export type HubLinkRequest = z.infer<typeof HubLinkRequestSchema>;

export function linkingProofText(key: string, data: string): string {
  return `veeloe-link/1\n${key}\n${data}`;
}

/**
 * HMAC-SHA256 keyed by the secret in the QR, over the new key and the exact
 * handoff text. The Hub carries the handoff but cannot change a byte of it, nor
 * aim it at a key of its own.
 */
export function linkingProof({ secret, key, data }: { secret: string; key: string; data: string }): string {
  return hmacOf(secret, linkingProofText(key, data));
}

export function checkLinkingProof(input: { secret: string; key: string; data: string }, proof: string): boolean {
  return same(linkingProof(input), proof);
}

/** Old device → its own Member: `data` is HandoffData as JSON text, which `proof` covers byte for byte. */
export const DeviceHandoffBodySchema = z.looseObject({ data: z.string().min(1).max(100_000), proof: z.string().min(1) });
export type DeviceHandoffBody = z.infer<typeof DeviceHandoffBodySchema>;

/** What the new device needs to be one of the Member's devices: where the Machines are, and the Member's other keys. */
export const HandoffDataSchema = z.looseObject({
  workspace: z.string().min(1),
  member: z.string().min(1),
  machines: z.array(z.looseObject({ id: z.string().min(1), key: z.string().min(1), name: z.string().min(1).max(255), hub: z.string().min(1) })),
  keys: z.array(z.looseObject({ key: z.string().min(1), name: z.string().max(80).optional() })),
});
export type HandoffData = z.infer<typeof HandoffDataSchema>;

/** New device → its own Member, signed by the new key: the handoff arrived and checked out. */
export const DeviceLinkedBodySchema = z.looseObject({});
