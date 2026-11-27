import { fromBase64url } from "../crypto/base64url";
import { verifySignature } from "../crypto/ed25519";
import { COPIED_HEADER_FIELDS, EnvelopeSchema, SignedPartSchema, type Route, type SignedPart } from "./schema";

/** The last sequence number accepted from each sender key. */
export interface SeenSequences {
  last(senderKey: string): number | undefined;
  record(senderKey: string, seq: number): void;
  /** Whether `seq` was never accepted. Without it only a number above the last one is; a store with a `SeenWindow` also takes one that came late by the slower of two paths (ADR 0090). */
  isNew?(senderKey: string, seq: number): boolean;
}

/** How many of the latest numbers from one sender may still arrive out of order (ADR 0090). */
export const SEEN_WINDOW = 1024;

/**
 * The numbers accepted from each sender in this run, so an envelope that took the Hub while the
 * next one took the direct link is accepted once and only once (ADR 0090). Only the highest number
 * is kept on disk: after a restart everything at or below it is refused, as before.
 */
export class SeenWindow {
  #senders = new Map<string, { floor: number; accepted: Set<number> }>();
  isNew(senderKey: string, seq: number, last: number | undefined) {
    const recent = this.#senders.get(senderKey);
    if (!recent) return last === undefined || seq > last;
    return seq > recent.floor && !recent.accepted.has(seq);
  }
  record(senderKey: string, seq: number, last: number | undefined) {
    let recent = this.#senders.get(senderKey);
    if (!recent) {
      recent = { floor: last ?? 0, accepted: new Set() };
      this.#senders.set(senderKey, recent);
    }
    recent.accepted.add(seq);
    // ponytail: a linear scan for the oldest, over at most SEEN_WINDOW + 1 numbers, only once the window is full.
    if (recent.accepted.size > SEEN_WINDOW) {
      const oldest = Math.min(...recent.accepted);
      recent.accepted.delete(oldest);
      recent.floor = Math.max(recent.floor, oldest);
    }
  }
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

export type Rejection = "malformed" | "untrusted-key" | "bad-signature" | "header-mismatch" | "not-addressed" | "replayed";

export type Verified = { ok: true; from: string; signed: SignedPart } | { ok: false; reason: Rejection };

const encoder = new TextEncoder();

function same(a: string | string[] | undefined, b: string | string[] | undefined) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => value === b[i]);
  return a === b;
}

/**
 * The receiver's checks, in order (ADR 0019): a trusted sender key, a valid
 * signature over the carried bytes, and only then parsing — then the header
 * must match its signed copy, the envelope must be meant for this receiver and
 * the counter must have gone up. The counter comes last, so that no rejected
 * envelope moves it.
 */
export function verify(envelope: unknown, trustedKeys: { has(key: string): boolean }, isForMe: (route: Route) => boolean, seen: SeenSequences): Verified {
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
    if (!same(header.data[field], part[field])) return { ok: false, reason: "header-mismatch" };
  }

  // Unchanged and correctly signed, yet a Hub can still hand it to the wrong receiver.
  const route: Route = part.to !== undefined ? { to: part.to } : { recipients: part.recipients ?? [] };
  if (!isForMe(route)) return { ok: false, reason: "not-addressed" };

  const last = seen.last(from);
  const fresh = seen.isNew ? seen.isNew(from, part.seq) : last === undefined || part.seq > last;
  if (!fresh) return { ok: false, reason: "replayed" };
  seen.record(from, part.seq);

  return { ok: true, from, signed: part };
}
