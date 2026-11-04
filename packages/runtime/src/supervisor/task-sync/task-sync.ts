import type { TaskSyncBody } from "@veeloe/protocol";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import type { Workers } from "../workers/workers";

/** `task.sync`: the events after N, answered by the worker that owns the Task (ADR 0021). */
export function createTaskSyncSlice({ registry, workers, outbox }: { registry: AgentRegistry; workers: Workers; outbox: Outbox }) {
  return (from: Inbound & { task: string }, body: TaskSyncBody) => {
    if (!registry.get(body.agent)) return outbox.error(from, "agent.unknown");
    const sent = workers.send(body.agent, { kind: "sync", task: from.task, after: body.after, member: from.member, ref: from.ref });
    if (!sent) outbox.error(from, "agent.unavailable");
  };
}
