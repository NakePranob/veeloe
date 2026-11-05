import { z } from "zod";
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

/** Controller → Machine: make an Agent. Sent again with the same id, it changes nothing. */
export const AgentCreateBodySchema = z.looseObject({
  id,
  name,
  provider: z.string().min(1),
  model: z.string().min(1),
  character: CharacterSchema.optional(),
});
export type AgentCreateBody = z.infer<typeof AgentCreateBodySchema>;

/** Controller → Machine: what is on this Machine. */
export const AgentListBodySchema = z.looseObject({});

const AgentSchema = z.looseObject({ id, name, provider: z.string().min(1), model: z.string().min(1), character: CharacterSchema.optional() });
export type Agent = z.infer<typeof AgentSchema>;

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
