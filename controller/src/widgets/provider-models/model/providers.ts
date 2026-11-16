import type { ProviderInfo } from "@veeloe/protocol-ts";

export type Model = { id: string; name?: string; contextWindow?: number };

// The schemas are loose (ADR 0023), so `in` alone does not narrow them.
export const modelsOf = (p: unknown): Model[] => (Array.isArray((p as { models?: unknown } | undefined)?.models) ? (p as { models: Model[] }).models : []);
export const errorOf = (p: unknown): string | null => {
  const error = (p as { error?: unknown } | undefined)?.error;
  return typeof error === "string" ? error : null;
};

/**
 * Why the Agent cannot answer, by what the Machine listed: its Provider is gone, or the Provider no
 * longer lists its model. Null when it is fine or nobody can tell yet: no list from the Machine, or a
 * Provider that could not say which models it has.
 */
export function providerProblem(agent: { provider: string; model: string }, providers: ProviderInfo[] | null): "provider" | "model" | null {
  if (!providers) return null;
  const provider = providers.find((p) => p.name === agent.provider);
  if (!provider) return "provider";
  if (errorOf(provider) !== null) return null;
  return modelsOf(provider).some((m) => m.id === agent.model) ? null : "model";
}
