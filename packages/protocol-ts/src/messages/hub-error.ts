import { z } from "zod";
import { ErrorBodySchema } from "./error";

/**
 * What the Hub says about a frame (ADR 0065). It is not signed, because a Hub has
 * no signing key, so treat it as a hint about delivery and nothing more.
 */
export const HubErrorSchema = ErrorBodySchema.extend({
  type: z.literal("hub.error"),
  /** The `sig` of the envelope this is about. */
  ref: z.string().min(1).optional(),
});
export type HubError = z.infer<typeof HubErrorSchema>;
