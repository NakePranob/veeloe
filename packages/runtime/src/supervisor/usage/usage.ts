import type { UsageGetBody, UsageListedBody } from "@veeloe/protocol";
import { canManage } from "../access";
import type { AgentRegistry } from "../agent-registry/registry";
import { budgetDay } from "../budget/budget";
import type { Inbound, Outbox } from "../outbox";
import { shiftDay } from "./day";
import type { UsageStore } from "./store";

/** How far back one request may look, so one answer stays bounded. */
export const MAX_USAGE_DAYS = 90;

/**
 * `usage.list`: the range is the Machine's own Budget days (ADR 0043), never
 * the asker's clock, and the answer goes to the asker alone (ADR 0066).
 */
export function createUsageSlice({
  registry,
  store,
  outbox,
  members,
  clock = { now: Date.now },
}: {
  registry: AgentRegistry;
  store: Pick<UsageStore, "range">;
  outbox: Outbox;
  /** Every Member in trust, who all Manage every Agent in v0.1. */
  members: () => string[];
  clock?: { now: () => number };
}) {
  return (from: Inbound, body: UsageGetBody) => {
    if (!Number.isInteger(body.days) || body.days < 1 || body.days > MAX_USAGE_DAYS) return outbox.error(from, "usage.invalid_range");

    let agents = registry.all().filter((agent) => canManage(from.member, agent, members()));
    if (body.agent !== undefined) {
      const agent = registry.get(body.agent);
      // Not saying an Agent exists to someone who may not see its usage.
      if (!agent || !canManage(from.member, agent, members())) return outbox.error(from, "agent.unknown");
      agents = [agent];
    }

    const to = budgetDay(clock.now());
    const start = shiftDay(to, -(body.days - 1));
    const answer: UsageListedBody = {
      request: body.request,
      from: start,
      to,
      agents: store.range({ agents: agents.map((agent) => agent.id), from: start, to }),
    };
    outbox.toMember(from.member, "usage.listed", answer);
  };
}
