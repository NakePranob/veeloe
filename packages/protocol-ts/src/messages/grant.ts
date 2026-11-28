import { z } from "zod";
import { AgentIdSchema } from "./ids";

/** A Member's id, as the Hub hands it out: the same shape as an Agent's. */
export const MemberIdSchema = AgentIdSchema;

/** What a Member may do at one Agent (ADR 0010); each level holds the ones below it. */
export const GrantLevelSchema = z.enum(["use", "approve", "manage"]);
export type GrantLevel = z.infer<typeof GrantLevelSchema>;

/**
 * Controller → Machine: `member` now has `level` at `agent`, or nothing with `none`.
 * Signed by an Owner or a Member with Manage there (ADR 0010); answered with `grants.listed`.
 */
export const GrantSetBodySchema = z.looseObject({ agent: AgentIdSchema, member: MemberIdSchema, level: z.union([GrantLevelSchema, z.literal("none")]) });
export type GrantSetBody = z.infer<typeof GrantSetBodySchema>;

/** Machine → Controller: every Grant at one Agent, Owners left out since they hold Manage everywhere. */
export const GrantsListedBodySchema = z.looseObject({
  agent: AgentIdSchema,
  grants: z.array(z.looseObject({ member: MemberIdSchema, level: GrantLevelSchema })).max(500),
});
export type GrantsListedBody = z.infer<typeof GrantsListedBodySchema>;
