import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { normalizeHubUrl } from "./hub-auth";
import { PAIRING_CLOCK_SKEW_SECONDS } from "./pairing-link";

/** How long the new device's QR is good for. */
export const LINKING_TTL_SECONDS = 600;

const PREFIX = "veeloe://link?";
const encoder = new TextEncoder();

/**
 * What the new device shows. Not signed: it goes from that screen into the old
 * device's camera, so no Hub stands between them to change it (ADR 0013).
 */
export type LinkingLink = {
  /** The Hub URL in normal form. */
  hub: string;
  /** The new device's public key, base64url. */
  key: string;
  /** Its name to start with, which the old device may change. */
  name: string;
  /** The random 256-bit secret, base64url. Never leaves the two devices. */
  secret: string;
  /** Unix seconds. */
  expires: number;
};

export function buildLinkingLink({ hub, key, name, secret, expires }: Omit<LinkingLink, "secret"> & { secret: Uint8Array }): string {
  return `${PREFIX}hub=${encodeURIComponent(normalizeHubUrl(hub))}&key=${key}&name=${encodeURIComponent(name)}&secret=${toBase64url(secret)}&exp=${expires}`;
}

export type ParsedLinkingLink = { ok: true; link: LinkingLink } | { ok: false; reason: "malformed" | "expired" };

function decodedLength(text: string): number | undefined {
  try {
    return fromBase64url(text).length;
  } catch {
    return undefined;
  }
}

/** Reads what was scanned or pasted on the old device. */
export function parseLinkingLink(text: string, nowMs: number): ParsedLinkingLink {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return { ok: false, reason: "malformed" };
  const fields = new Map<string, string>();
  for (const pair of trimmed.slice(PREFIX.length).split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) fields.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const { key, secret, exp } = Object.fromEntries(fields);
  if (!key || !secret || !exp || !/^[1-9][0-9]{0,14}$/.test(exp)) return { ok: false, reason: "malformed" };
  if (decodedLength(key) !== 32 || decodedLength(secret) !== 32) return { ok: false, reason: "malformed" };
  let hub: string, name: string;
  try {
    hub = normalizeHubUrl(decodeURIComponent(fields.get("hub") ?? ""));
    name = decodeURIComponent(fields.get("name") ?? "").trim();
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!name || name.length > 80) return { ok: false, reason: "malformed" };
  const expires = Number(exp);
  if (expires + PAIRING_CLOCK_SKEW_SECONDS < nowMs / 1000) return { ok: false, reason: "expired" };
  return { ok: true, link: { hub, key, name, secret, expires } };
}

export function linkingProofText(key: string, data: string): string {
  return `veeloe-link/1\n${key}\n${data}`;
}

/**
 * HMAC-SHA256 keyed by the secret in the QR, over the new key and the exact
 * handoff text. The Hub carries the handoff but cannot change a byte of it, nor
 * aim it at a key of its own.
 */
export function linkingProof({ secret, key, data }: { secret: string; key: string; data: string }): string {
  return toBase64url(hmac(sha256, fromBase64url(secret), encoder.encode(linkingProofText(key, data))));
}

export function checkLinkingProof(input: { secret: string; key: string; data: string }, proof: string): boolean {
  const expected = linkingProof(input);
  if (proof.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return difference === 0;
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
