import { toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign } from "../crypto/ed25519";
import type { Envelope } from "./schema";

export type Outgoing = {
  type: string;
  to: string;
  task?: string;
  member?: string;
  body: unknown;
};

/**
 * Signs envelopes as one sender. `nextSeq` hands out that sender's counter;
 * it must keep going up across restarts, so the caller owns where it lives.
 */
export function createSigner(secretKey: Uint8Array, nextSeq: () => number) {
  const from = toBase64url(publicKeyOf(secretKey));
  const encoder = new TextEncoder();

  return function signEnvelope(out: Outgoing): Envelope {
    const routing = Object.fromEntries(
      Object.entries({ type: out.type, to: out.to, task: out.task, member: out.member }).filter(([, v]) => v !== undefined),
    ) as Pick<Envelope, "type" | "to" | "task" | "member">;
    // Serialized once; these exact bytes are signed and carried (ADR 0019).
    const signed = JSON.stringify({ ...routing, seq: nextSeq(), body: out.body });
    const sig = toBase64url(sign(encoder.encode(signed), secretKey));
    return { v: 1, ...routing, from, signed, sig };
  };
}
