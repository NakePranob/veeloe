import { z } from "zod";
import { AllowlistSchema } from "./allowlist";
import { EgressSchema } from "./egress";

/** Also a folder name on the Machine (ADR 0032), so nothing that could leave it. */
export const AgentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
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
  /** Today's tokens, as of this answer. Absent from a Machine older than `daily-budget`. */
  usage: usage.optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** Machine → Member: how today's tokens stand for one Agent, after every answer that was counted. */
export const AgentUsageBodySchema = z.looseObject({ agent: id, day, tokens: z.number().int().min(0), budget });
export type AgentUsageBody = z.infer<typeof AgentUsageBodySchema>;

/** A Provider by name, never its URL or key: the models it offers, or why it could not say. */
const ProviderSchema = z.union([
  z.looseObject({ name: z.string().min(1), models: z.array(z.looseObject({ id: z.string().min(1), name: z.string().optional() })) }),
  z.looseObject({ name: z.string().min(1), error: z.string().min(1) }),
]);
export type ProviderInfo = z.infer<typeof ProviderSchema>;

/** Machine → Member: the answer to both requests above. */
export const AgentListedBodySchema = z.looseObject({
  agents: z.array(AgentSchema),
  providers: z.array(ProviderSchema),
  /** The Machine's Egress (`sandboxed-commands`). Absent from a Machine older than that. */
  egress: EgressSchema.optional(),
});
export type AgentListedBody = z.infer<typeof AgentListedBodySchema>;
