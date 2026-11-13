import { z } from "zod";
import { AllowlistSchema } from "./allowlist";
import { EgressSchema } from "./egress";
import { AgentIdSchema } from "./ids";

/** Also a folder name on the Machine (ADR 0032), so nothing that could leave it. */
export { AgentIdSchema };
const id = AgentIdSchema;
const name = z.string().trim().min(1).max(80);

/**
 * How the Agent's Character looks, picked by the Controller and kept by the Machine. Parts are
 * bounded words, not a closed list: a newer Controller's new part must still pass (ADR 0023).
 */
const part = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const CharacterSchema = z.looseObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), shell: part, top: part, sides: part, decal: part });

/** Tokens per day: a whole number, never zero, up to a trillion (`daily-budget`, ADR 0043). */
const budget = z.number().int().min(1).max(1_000_000_000_000);

/** How long one Approval waits, in whole seconds: a minute to a day (`approval-and-allowlist`). */
export const APPROVAL_TIMEOUT_S_MIN = 60;
export const APPROVAL_TIMEOUT_S_MAX = 86_400;
export const APPROVAL_TIMEOUT_S_DEFAULT = 3_600;
const approvalTimeoutS = z.number().int().min(APPROVAL_TIMEOUT_S_MIN).max(APPROVAL_TIMEOUT_S_MAX);

/** The day of a Budget in the Machine's own time (ADR 0043). */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const usage = z.looseObject({ day, tokens: z.number().int().min(0) });

/** Controller → Machine: make an Agent. Sent again with the same id, it changes nothing. */
export const AgentCreateBodySchema = z.looseObject({
  id,
  name,
  provider: z.string().min(1),
  model: z.string().min(1),
  character: CharacterSchema.optional(),
  allowlist: AllowlistSchema.optional(),
  approvalTimeoutS: approvalTimeoutS.optional(),
});
export type AgentCreateBody = z.infer<typeof AgentCreateBodySchema>;

/**
 * Controller → Machine: change only the fields sent, all or none (`agent-settings`). A model
 * belongs to its Provider, so a new Provider comes with its model.
 */
export const AgentUpdateBodySchema = z
  .looseObject({ id, name: name.optional(), provider: z.string().min(1).optional(), model: z.string().min(1).optional(), character: CharacterSchema.optional(), budget: budget.optional(), allowlist: AllowlistSchema.optional(), approvalTimeoutS: approvalTimeoutS.optional() })
  .refine((b) => b.name !== undefined || b.provider !== undefined || b.model !== undefined || b.character !== undefined || b.budget !== undefined || b.allowlist !== undefined || b.approvalTimeoutS !== undefined, "nothing to change")
  .refine((b) => b.provider === undefined || b.model !== undefined, "a provider needs its model");
export type AgentUpdateBody = z.infer<typeof AgentUpdateBodySchema>;

/** Controller → Machine: remove an Agent. Its Workdir and Task history stay. */
export const AgentDeleteBodySchema = z.looseObject({ id });
export type AgentDeleteBody = z.infer<typeof AgentDeleteBodySchema>;

/** Controller → Machine: bring back an Agent it deleted, before the Machine purges it (`agent-trash`). */
export const AgentRestoreBodySchema = z.looseObject({ id });
export type AgentRestoreBody = z.infer<typeof AgentRestoreBodySchema>;

/** Controller → Machine: what is on this Machine. */
export const AgentListBodySchema = z.looseObject({});

const AgentSchema = z.looseObject({
  id,
  name,
  provider: z.string().min(1),
  model: z.string().min(1),
  character: CharacterSchema.optional(),
  /** What this Agent may run without an Approval. Absent from a Machine older than `approval-and-allowlist`. */
  allowlist: AllowlistSchema.optional(),
  /** How long one Approval waits, in seconds. Absent from a Machine older than `approval-and-allowlist`. */
  approvalTimeoutS: approvalTimeoutS.optional(),
  /** The Budget the Machine keeps, defaulted when it never said one (`daily-budget`). */
  budget: budget.optional(),
  /**
   * What this Agent itself may reach (ADR 0029, issue #43). The Machine may still
   * send one top-level `egress` for a Controller that knows only that shape.
   */
  egress: EgressSchema.optional(),
  /** Today's tokens, as of this answer. Absent from a Machine older than `daily-budget`. */
  usage: usage.optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * An Agent the Machine still holds after a delete (`agent-trash`): everything an Agent has,
 * plus when it was deleted and when the Machine will purge it. Both are epoch milliseconds.
 */
export const AgentTrashEntrySchema = AgentSchema.extend({
  deletedAt: z.number().int().nonnegative(),
  restoreUntil: z.number().int().nonnegative(),
});
export type AgentTrashEntry = z.infer<typeof AgentTrashEntrySchema>;

/** Machine → Member: how today's tokens stand for one Agent, after every answer that was counted. */
export const AgentUsageBodySchema = z.looseObject({ agent: id, day, tokens: z.number().int().min(0), budget });
export type AgentUsageBody = z.infer<typeof AgentUsageBodySchema>;

/** Machine → Member: the health of the Machine, without any Task content. */
export const MachineStatusBodySchema = z.looseObject({
  version: z.string().min(1),
  features: z.array(z.string().min(1)),
  lastError: z.string().nullable(),
  diskFreeBytes: z.number().int().nonnegative(),
  budgetToday: z.looseObject({ usedTokens: z.number().int().nonnegative(), limitTokens: z.number().int().nonnegative() }).optional(),
});
export type MachineStatusBody = z.infer<typeof MachineStatusBodySchema>;

/** A Provider by name, never its URL or key: the models it offers, or why it could not say. */
const ProviderSchema = z.union([
  z.looseObject({ name: z.string().min(1), models: z.array(z.looseObject({ id: z.string().min(1), name: z.string().optional(), contextWindow: z.number().int().positive().optional() })) }),
  z.looseObject({ name: z.string().min(1), error: z.string().min(1) }),
]);
export type ProviderInfo = z.infer<typeof ProviderSchema>;

/** Machine → Member: the answer to both requests above. */
export const AgentListedBodySchema = z.looseObject({
  agents: z.array(AgentSchema),
  /** Agents the Machine deleted and has not purged yet. Absent from a Machine older than `agent-trash`. */
  trash: z.array(AgentTrashEntrySchema).optional(),
  providers: z.array(ProviderSchema),
  /** Every Agent's Egress together, for a Controller that reads only this shape
   * (`sandboxed-commands`, ADR 0029, issue #43). Each Agent's own list is in it. */
  egress: EgressSchema.optional(),
});
export type AgentListedBody = z.infer<typeof AgentListedBodySchema>;
