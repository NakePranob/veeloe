import type { Agent, AgentCreateBody, AgentListedBody, AgentUpdateBody, ProviderInfo } from "@veeloe/protocol";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import { listModels } from "../providers/models";
import type { Provider } from "../providers/store";
import type { Workers } from "../workers/workers";

/**
 * Who may change an Agent: Manage (ADR 0059). In v0.1 the only Members in trust
 * are Owners, who Manage every Agent. v0.3 reads Grants here.
 */
export const canManage = (member: string, _agent: Agent, members: string[]) => members.includes(member);

/** `agent.create`, `agent.update` and `agent.list` (ADR 0020, 0042). Each answers with the whole list and the Machine's Egress, never a Provider's URL or key. */
export function createAgentsSlice({
  registry,
  workers,
  providers,
  egress,
  outbox,
  members,
  fetchFn,
}: {
  registry: AgentRegistry;
  workers: Pick<Workers, "start" | "rename">;
  providers: () => Provider[];
  egress: () => string[];
  outbox: Outbox;
  /** Every Member in trust, who all hear of a change. */
  members: () => string[];
  fetchFn?: typeof fetch;
}) {
  async function providerInfo(): Promise<ProviderInfo[]> {
    return Promise.all(
      providers().map(async (p) => {
        const result = await listModels(p, { fetchFn });
        return result.ok ? { name: p.name, models: result.models } : { name: p.name, error: result.problem };
      }),
    );
  }

  async function listed(): Promise<AgentListedBody> {
    return { agents: registry.all(), providers: await providerInfo(), egress: egress() };
  }

  return {
    listed,
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
        // The look is kept as sent, so it never changes with a Controller's version (ADR 0006).
        const agent = { id: body.id, name: body.name, provider: body.provider, model: body.model, ...(body.character && { character: body.character }) };
        registry.add(agent);
        workers.start(agent);
      }
      outbox.toMember(from.member, "agent.listed", await listed());
    },

    /** Every field is checked before any is written, so a refused change changes nothing (`agent-settings`). */
    async update(from: Inbound, body: AgentUpdateBody) {
      const agent = registry.get(body.id);
      // Not saying an Agent exists to someone who may not change it.
      if (!agent || !canManage(from.member, agent, members())) return outbox.error(from, "agent.unknown");
      if (body.model !== undefined) {
        const provider = providers().find((p) => p.name === (body.provider ?? agent.provider));
        if (!provider) return outbox.error(from, "agent.provider_unknown");
        const models = await listModels(provider, { fetchFn });
        if (!models.ok) return outbox.error(from, models.problem);
        if (!models.models.some((m) => m.id === body.model)) return outbox.error(from, "agent.provider_unknown");
      }
      // Read again so a change that landed while the models were asked for is kept; the model stays with the Provider it was checked against.
      const now = registry.get(body.id)!;
      const next: Agent = {
        ...now,
        ...(body.name !== undefined && { name: body.name }),
        ...(body.model !== undefined && { provider: body.provider ?? agent.provider, model: body.model }),
        ...(body.character && { character: body.character }),
      };
      registry.replace(next);
      if (next.name !== now.name) workers.rename(next);
      const list = await listed();
      for (const member of members()) outbox.toMember(member, "agent.listed", list);
    },
  };
}
