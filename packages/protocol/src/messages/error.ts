import { z } from "zod";

// ADR 0065: a code and values, never a sentence; the Controller renders the words
// in the Member's language. The codes stay open because a newer sender may add one (ADR 0023).
export const ErrorBodySchema = z.looseObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
