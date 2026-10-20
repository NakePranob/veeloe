import { fromBase64url } from "../crypto/base64url";
import { verifySignature } from "../crypto/ed25519";
import { COPIED_HEADER_FIELDS, EnvelopeSchema, SignedPartSchema, type SignedPart } from "./schema";

/** The last sequence number accepted from each sender key. */
export interface SeenSequences {
  last(senderKey: string): number | undefined;
  record(senderKey: string, seq: number): void;
}

// ponytail: in memory only. The Runtime's own store, which survives a restart,
// comes with the first signed command (#9).
export class MemorySeenSequences implements SeenSequences {
  #last = new Map<string, number>();
  last(senderKey: string) {
    return this.#last.get(senderKey);
  }
  record(senderKey: string, seq: number) {
    this.#last.set(senderKey, seq);
  }
}

export type Rejection = "malformed" | "untrusted-key" | "bad-signature" | "header-mismatch" | "replayed";

export type Verified = { ok: true; from: string; signed: SignedPart } | { ok: false; reason: Rejection };

const encoder = new TextEncoder();

/**
 * The receiver's checks, in order (ADR 0019): a trusted sender key, a valid
 * signature over the carried bytes, and only then parsing — then the header
 * must match its signed copy and the counter must have gone up.
 */
export function verify(envelope: unknown, trustedKeys: { has(key: string): boolean }, seen: SeenSequences): Verified {
  const header = EnvelopeSchema.safeParse(envelope);
  if (!header.success) return { ok: false, reason: "malformed" };
  const { from, signed, sig } = header.data;

  if (!trustedKeys.has(from)) return { ok: false, reason: "untrusted-key" };
  let publicKey: Uint8Array, signature: Uint8Array;
  try {
    publicKey = fromBase64url(from);
    signature = fromBase64url(sig);
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  if (!verifySignature(signature, encoder.encode(signed), publicKey)) return { ok: false, reason: "bad-signature" };

  let part: SignedPart;
  try {
    const parsed = SignedPartSchema.safeParse(JSON.parse(signed));
    if (!parsed.success) return { ok: false, reason: "malformed" };
    part = parsed.data;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  for (const field of COPIED_HEADER_FIELDS) {
    if (header.data[field] !== part[field]) return { ok: false, reason: "header-mismatch" };
  }

  const last = seen.last(from);
  if (last !== undefined && part.seq <= last) return { ok: false, reason: "replayed" };
  seen.record(from, part.seq);

  return { ok: true, from, signed: part };
}
