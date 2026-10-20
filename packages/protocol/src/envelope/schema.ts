import { z } from "zod";

// ADR 0023: every schema is loose — a receiver keeps going past fields it does
// not know, so a newer sender never breaks an older receiver.

/** The routing header the Hub reads (ADR 0005), plus the signed bytes and signature. */
export const EnvelopeSchema = z.looseObject({
  v: z.literal(1),
  type: z.string().min(1),
  /** The sender's public key, base64url. Picks the key to verify with. */
  from: z.string().min(1),
  to: z.string().min(1),
  task: z.string().min(1).optional(),
  /** The Member who started the originating Task (ADR 0010). */
  member: z.string().min(1).optional(),
  /** The exact JSON text the sender signed (ADR 0019). */
  signed: z.string(),
  /** Ed25519 over the UTF-8 bytes of `signed`, base64url. */
  sig: z.string().min(1),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** The fields of the header that the signed part must copy. */
export const COPIED_HEADER_FIELDS = ["type", "to", "task", "member"] as const;

/** What the sender signs: copies of the routing header, its counter, and the body. */
export const SignedPartSchema = z.looseObject({
  type: z.string().min(1),
  to: z.string().min(1),
  task: z.string().min(1).optional(),
  member: z.string().min(1).optional(),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  body: z.unknown(),
});
export type SignedPart = z.infer<typeof SignedPartSchema>;
