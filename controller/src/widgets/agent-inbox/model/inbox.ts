import { statusOf, type Latest, type TaskStatus } from "../../../entities/task";

export type InboxAgent = { id: string; machine_id: string };
export type InboxTask = Latest & { id: string; agent_id: string; updated_at: number };

// A failed Turn sorts with the finished ones, by time.
const ORDER: Record<TaskStatus, number> = { working: 0, failed: 1, done: 1, new: 2, offline: 3 };

/**
 * One row per Agent, as the prototype's Inbox has it: the Agent's latest Task,
 * working ones first, then by when they last moved. A row with no Task opens a new one.
 */
export function inboxRows<A extends InboxAgent, T extends InboxTask>(agents: A[], tasks: T[], online: (machine: string) => boolean | null) {
  return agents
    .map((agent) => {
      const task = tasks.filter((t) => t.agent_id === agent.id).sort((a, b) => b.updated_at - a.updated_at)[0];
      return { agent, task, status: statusOf(task, online(agent.machine_id)) };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.task?.updated_at ?? 0) - (a.task?.updated_at ?? 0));
}
