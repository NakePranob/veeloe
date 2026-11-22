import { type AgentRow, deletedAgent } from "../../../entities/agent";
import { latestOf, statusOf, type TaskEventRow } from "../../../entities/task";

type Named = Pick<AgentRow, "id" | "name" | "machine_id">;

/**
 * The Agent a Task belongs to, and whether the page may only read. A deleted Agent still names its Tasks while it
 * waits in the trash (`agent-trash`), else the word for a deleted Agent; its Machine comes from the trash or the Task.
 * Sending, Stop and settings need the Agent itself; the history does not.
 */
export function agentOf(agentId: string, agents: readonly AgentRow[], trashed: readonly Named[], taskMachine: string | undefined, deletedName: string): { agent: AgentRow; readOnly: boolean } {
  const found = agents.find((a) => a.id === agentId);
  if (found) return { agent: found, readOnly: false };
  const gone = trashed.find((a) => a.id === agentId);
  return { agent: deletedAgent(agentId, gone?.machine_id ?? taskMachine, gone?.name ?? deletedName), readOnly: true };
}

/**
 * A Turn is running: the Machine queues a new message until it ends. A stalled Turn (ADR 0073) is still open, and is
 * when the Owner most needs Stop.
 */
export function busyOf(events: readonly Pick<TaskEventRow, "kind" | "body">[] | undefined): boolean {
  if (!events) return false;
  const status = statusOf(latestOf(events), true);
  return status === "working" || status === "stuck";
}

/**
 * Whether the brake still says it is stopping. It stops saying so once the Turn ended (by the Stop or by itself) or the
 * Machine refused the Stop: then nothing is stopping any more, and `asked` goes back to false.
 */
export function stopStateOf(asked: boolean, busy: boolean, stopError: string | null | undefined): { asked: boolean; stopping: boolean } {
  const still = asked && busy && !stopError;
  return { asked: still, stopping: still };
}
