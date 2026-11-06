import type { TaskMessageBody } from "@veeloe/protocol";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import type { Workers } from "../workers/workers";

/** `task.message`: a Member's words, verified, to the Agent's worker. */
export function createTaskMessageSlice({
  registry,
  workers,
  outbox,
  exhausted = () => false,
}: {
  registry: AgentRegistry;
  workers: Workers;
  outbox: Outbox;
  /** True when today's tokens have reached the Agent's Budget (`daily-budget`, ADR 0043). */
  exhausted?: (agent: string) => boolean;
}) {
  return (from: Inbound & { task: string }, body: TaskMessageBody) => {
    if (!registry.get(body.agent)) return outbox.error(from, "agent.unknown");
    // A new Turn would be refused at its first LLM call anyway; saying so here keeps the message from the worker.
    if (exhausted(body.agent)) return outbox.error(from, "budget.exhausted");
    const sent = workers.send(body.agent, { kind: "message", task: from.task, id: body.id, member: from.member, text: body.text, ref: from.ref });
    if (!sent) outbox.error(from, "agent.unavailable");
  };
}
