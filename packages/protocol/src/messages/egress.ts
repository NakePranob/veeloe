import { z } from "zod";

/** How many domains one Machine's Egress may hold. */
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

/** The whole list, as the Machine keeps it: the same list sent twice changes nothing. */
export const EgressSchema = z.array(EgressDomainSchema).max(EGRESS_MAX);

/** Controller → Machine: this is the Machine's Egress now. Answered with `agent.listed`. */
export const EgressSetBodySchema = z.looseObject({ egress: EgressSchema });
export type EgressSetBody = z.infer<typeof EgressSetBodySchema>;
