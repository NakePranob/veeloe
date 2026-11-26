import { z } from "zod";

/** The Hub's first frame on every connection (ADR 0013). */
export const HubChallengeSchema = z.looseObject({
  type: z.literal("hub.challenge"),
  v: z.literal(1),
  /** At least 32 random bytes, base64url, fresh for this connection. */
  nonce: z.string().min(43),
});
export type HubChallenge = z.infer<typeof HubChallengeSchema>;
