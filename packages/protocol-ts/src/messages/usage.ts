import { z } from "zod";
import { AgentIdSchema } from "./agent";

/** A day of the Budget as the Machine names it: 04:00 to 04:00 in its own time (ADR 0043). */
export const UsageDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Controller → Machine: how far back to look, and which Agent, or every Agent the Member manages. */
export const UsageGetBodySchema = z.looseObject({
  /** Echoed in the answer, so a slow answer to an older request can be dropped. */
  request: z.string().min(1).max(64),
  days: z.number().int(),
  agent: AgentIdSchema.optional(),
});
export type UsageGetBody = z.infer<typeof UsageGetBodySchema>;

const tokens = z.number().int().min(0);

/** One Agent's totals in the range. Days with no counted answer are absent, never zero. */
export const UsageAgentSchema = z.looseObject({
  agent: AgentIdSchema,
  days: z.array(z.looseObject({ day: UsageDaySchema, tokens })).max(90),
  /** The Tasks that used the most tokens, at most 20; tokens not tied to a Task are not here. */
  tasks: z.array(z.looseObject({ task: z.string().min(1).max(64), tokens })).max(20),
  sources: z.array(z.looseObject({ source: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), tokens })),
});
export type UsageAgent = z.infer<typeof UsageAgentSchema>;

/** Machine → Member: the range it chose from its own clock, and what it kept of it. */
export const UsageListedBodySchema = z
  .looseObject({
    request: z.string().min(1).max(64),
    from: UsageDaySchema,
    to: UsageDaySchema,
    agents: z.array(UsageAgentSchema),
  })
  .refine((body) => body.from <= body.to, "from after to");
export type UsageListedBody = z.infer<typeof UsageListedBodySchema>;
