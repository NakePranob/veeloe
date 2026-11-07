import type { TaskStopBody } from "@veeloe/protocol";
import { canUse } from "../access";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import type { Workers } from "../workers/workers";

/**
 * `task.stop` (`stop-and-restart`, ADR 0017): the Member's brake reaches the
 * Agent's worker, which ends the Turn. Stop is a brake, not a right beyond the
 * sender's own: anyone who may use the Agent may stop any of its Turns.
 */
export function createTaskStopSlice({
  registry,
  workers,
  outbox,
  members,
}: {
  registry: AgentRegistry;
  workers: Pick<Workers, "send">;
  outbox: Outbox;
  /** Every Member in trust, who all may stop every Agent in v0.1. */
  members: () => string[];
}) {
  return (from: Inbound & { task: string }, body: TaskStopBody) => {
    const agent = registry.get(body.agent);
    // Not saying an Agent exists to someone who may not stop it.
    if (!agent || !canUse(from.member, agent, members())) return outbox.error(from, "agent.unknown");
    const sent = workers.send(agent.id, { kind: "stop", task: from.task, id: body.id, member: from.member, ref: from.ref });
    if (!sent) outbox.error(from, "agent.unavailable");
  };
}
