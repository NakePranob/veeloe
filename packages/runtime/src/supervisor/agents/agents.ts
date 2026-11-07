import { APPROVAL_TIMEOUT_S_DEFAULT, type Agent, type AgentCreateBody, type AgentListedBody, type AgentUpdateBody, type ProviderInfo } from "@veeloe/protocol";
import { canManage } from "../access";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Budgets } from "../budget/budget";
import type { Inbound, Outbox } from "../outbox";
import { listModels } from "../providers/models";
import type { Provider } from "../providers/store";
import type { Workers } from "../workers/workers";

/** `agent.create`, `agent.update` and `agent.list` (ADR 0020, 0042). Each answers with the whole list and the Machine's Egress, never a Provider's URL or key. */
export function createAgentsSlice({
  registry,
  workers,
  providers,
  egress,
  outbox,
  members,
  budgets,
  fetchFn,
}: {
  registry: AgentRegistry;
  workers: Pick<Workers, "start" | "rename">;
  providers: () => Provider[];
  egress: () => string[];
  outbox: Outbox;
  /** Every Member in trust, who all hear of a change. */
  members: () => string[];
  /** Today's tokens and the Budget for each Agent (`daily-budget`, ADR 0043). */
  budgets: Pick<Budgets, "listedOf">;
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
    // The Budget is filled in here, so an Agent made before `daily-budget` shows its default (ADR 0023).
    // So are the Allowlist (empty) and the Approval timeout (an hour), for Agents made before `approval-and-allowlist`.
    return { agents: registry.all().map((agent) => ({ allowlist: [], approvalTimeoutS: APPROVAL_TIMEOUT_S_DEFAULT, ...agent, ...budgets.listedOf(agent) })), providers: await providerInfo(), egress: egress() };
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
        const agent: Agent = {
          id: body.id,
          name: body.name,
          provider: body.provider,
          model: body.model,
          ...(body.character && { character: body.character }),
          allowlist: body.allowlist ?? [],
          approvalTimeoutS: body.approvalTimeoutS ?? APPROVAL_TIMEOUT_S_DEFAULT,
        };
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
        ...(body.budget !== undefined && { budget: body.budget }),
        ...(body.allowlist !== undefined && { allowlist: body.allowlist }),
        ...(body.approvalTimeoutS !== undefined && { approvalTimeoutS: body.approvalTimeoutS }),
      };
      registry.replace(next);
      if (next.name !== now.name || JSON.stringify(next.allowlist ?? []) !== JSON.stringify(now.allowlist ?? []) || (next.approvalTimeoutS ?? APPROVAL_TIMEOUT_S_DEFAULT) !== (now.approvalTimeoutS ?? APPROVAL_TIMEOUT_S_DEFAULT)) workers.rename(next);
      const list = await listed();
      for (const member of members()) outbox.toMember(member, "agent.listed", list);
    },
  };
}
