import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound } from "../outbox";
import type { Workers } from "../workers/workers";

/**
 * `task.list`: each Agent's worker answers with the Tasks this Member started, and
 * each answer goes back as its own `task.listed`. An Agent with no worker right now
 * says nothing, and the Controller asks again on its next connect.
 */
export function createTaskListSlice({ registry, workers }: { registry: AgentRegistry; workers: Workers }) {
  return (from: Inbound) => {
    for (const agent of registry.all()) workers.send(agent.id, { kind: "list", member: from.member });
  };
}
