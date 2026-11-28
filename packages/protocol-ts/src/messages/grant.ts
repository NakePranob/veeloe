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

/** Controller → Machine: the Grants at one Agent, for whoever manages it. Answered with `grants.listed`. */
export const GrantListBodySchema = z.looseObject({ agent: AgentIdSchema });

/** Machine → Controller: every Grant at one Agent, Owners left out since they hold Manage everywhere. */
export const GrantsListedBodySchema = z.looseObject({
  agent: AgentIdSchema,
  grants: z.array(z.looseObject({ member: MemberIdSchema, level: GrantLevelSchema })).max(500),
});
export type GrantsListedBody = z.infer<typeof GrantsListedBodySchema>;

/**
 * A group of Members with one set of Grants (ADR 0091). Controller → Machine as `group.set`, each
 * Machine getting only its own Agents' Grants; a copy gives way only to a higher `version`.
 */
export const GroupSchema = z.looseObject({
  id: AgentIdSchema,
  name: z.string().trim().min(1).max(60),
  version: z.number().int().min(1),
  members: z.array(MemberIdSchema).max(500),
  admins: z.array(MemberIdSchema).max(50),
  grants: z.array(z.looseObject({ agent: AgentIdSchema, level: GrantLevelSchema })).max(200),
});
export type Group = z.infer<typeof GroupSchema>;

/** Controller → Machine: the groups the sender sees. Answered with `groups.listed`. */
export const GroupListBodySchema = z.looseObject({});

/** Machine → Controller: every group for an Owner, else the ones the Member is in or looks after. */
export const GroupsListedBodySchema = z.looseObject({ groups: z.array(GroupSchema).max(200) });
