import { z } from "zod";
import { AgentIdSchema } from "./ids";

/** How many domains one Agent's Egress may hold. */
export const EGRESS_MAX = 100;

/**
 * One Egress entry (ADR 0008, 0029): a lowercase domain name whose last label
 * is letters, or the same with one `*.` in front. So an IP address, `localhost`,
 * a scheme, a port or a path never fits, and neither does `*.com` or `*.*`.
 */
export const EgressDomainSchema = z
  .string()
  .max(253)
  .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

/** The whole list, as one Agent keeps it: the same list sent twice changes nothing. */
export const EgressSchema = z.array(EgressDomainSchema).max(EGRESS_MAX);

/**
 * Controller → Machine: this is an Egress now. Without `agent` it is every Agent's
 * list, as before issue #43; with it, only that Agent's (ADR 0029). Answered with
 * `agent.listed`.
 */
export const EgressSetBodySchema = z.looseObject({ egress: EgressSchema, agent: AgentIdSchema.optional() });
export type EgressSetBody = z.infer<typeof EgressSetBodySchema>;
