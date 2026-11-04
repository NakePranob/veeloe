import type { TaskMessageBody } from "@veeloe/protocol";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import type { Workers } from "../workers/workers";

/** `task.message`: a Member's words, verified, to the Agent's worker. */
export function createTaskMessageSlice({ registry, workers, outbox }: { registry: AgentRegistry; workers: Workers; outbox: Outbox }) {
  return (from: Inbound & { task: string }, body: TaskMessageBody) => {
    if (!registry.get(body.agent)) return outbox.error(from, "agent.unknown");
    const sent = workers.send(body.agent, { kind: "message", task: from.task, id: body.id, member: from.member, text: body.text, ref: from.ref });
    if (!sent) outbox.error(from, "agent.unavailable");
  };
}
