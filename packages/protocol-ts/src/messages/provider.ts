import { z } from "zod";

/** Controller → Machine: add a Provider, with its key sealed to the Machine identity. */
export const ProviderAddBodySchema = z.looseObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  url: z.string().url(),
  preset: z.string().min(1).max(64).optional(),
  /** base64url of the sealed box; never the plaintext key. */
  key: z.string().min(1),
});
export type ProviderAddBody = z.infer<typeof ProviderAddBodySchema>;
