import type { Agent, ApprovalAnswerBody } from "@veeloe/protocol";
import { canApprove, canManage } from "../access";
import type { AgentRegistry } from "../agent-registry/registry";
import type { Inbound, Outbox } from "../outbox";
import type { Workers } from "../workers/workers";

/** `approval.answer` (Controller → Machine): one answer to one waiting Approval (`approval-and-allowlist`). */
export function createApprovalsSlice({
  registry,
  workers,
  outbox,
  members,
  broadcast,
}: {
  registry: AgentRegistry;
  workers: Pick<Workers, "send">;
  outbox: Outbox;
  /** Every Member in trust, who all hear of an Allowlist grown by allow-always. */
  members: () => string[];
  /** Send the new `agent.listed` to every Member, after an allow-always addition. */
  broadcast: () => void;
}) {
  return {
    answer(from: Inbound, body: ApprovalAnswerBody) {
      const agent = registry.get(body.agent);
      // Not saying an Agent exists to someone who may not answer for it.
      if (!agent || !canApprove(from.member, agent, members())) return outbox.error(from, "agent.unknown");
      // Allow-always adds to the Allowlist too, so it needs Manage as well.
      if (body.allowAlways !== undefined && !canManage(from.member, agent, members())) return outbox.error(from, "agent.unknown");
      if (body.allowAlways !== undefined) {
        const kept = agent.allowlist ?? [];
        const next: Agent = { ...agent, allowlist: kept.includes(body.allowAlways) ? kept : [...kept, body.allowAlways] };
        registry.replace(next);
        broadcast();
      }
      if (!workers.send(agent.id, { kind: "approval", request: body.request, decision: body.decision, ...(body.message !== undefined && { message: body.message }), member: from.member, ref: from.ref, ...(from.task !== undefined && { task: from.task }) })) {
        outbox.error(from, "agent.unavailable");
      }
    },
  };
}
export type ApprovalsSlice = ReturnType<typeof createApprovalsSlice>;
