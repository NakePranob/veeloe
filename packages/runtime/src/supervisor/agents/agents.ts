import type { AgentCreateBody, AgentListedBody, ProviderInfo } from "@veeloe/protocol";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import { listModels } from "../providers/models";
import type { Provider } from "../providers/store";
import type { Workers } from "../workers/workers";

/** `agent.create` and `agent.list` (ADR 0020, 0042). Both answer with the whole list, never a Provider's URL or key. */
export function createAgentsSlice({ registry, workers, providers, outbox, fetchFn }: { registry: AgentRegistry; workers: Workers; providers: () => Provider[]; outbox: Outbox; fetchFn?: typeof fetch }) {
  async function providerInfo(): Promise<ProviderInfo[]> {
    return Promise.all(
      providers().map(async (p) => {
        const result = await listModels(p, { fetchFn });
        return result.ok ? { name: p.name, models: result.models } : { name: p.name, error: result.problem };
      }),
    );
  }

  async function listed(): Promise<AgentListedBody> {
    return { agents: registry.all(), providers: await providerInfo() };
  }

  return {
    async list(from: Inbound) {
      outbox.toMember(from.member, "agent.listed", await listed());
    },

    async create(from: Inbound, body: AgentCreateBody) {
      if (!registry.get(body.id)) {
        const provider = providers().find((p) => p.name === body.provider);
        if (!provider) return outbox.error(from, "agent.provider_unknown");
        const models = await listModels(provider, { fetchFn });
        if (!models.ok) return outbox.error(from, models.problem);
        if (!models.models.some((m) => m.id === body.model)) return outbox.error(from, "agent.provider_unknown");
        const agent = { id: body.id, name: body.name, provider: body.provider, model: body.model };
        registry.add(agent);
        workers.start(agent);
      }
      outbox.toMember(from.member, "agent.listed", await listed());
    },
  };
}
