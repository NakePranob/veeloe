import { isQuiet, needsYou, statusOf, type Latest, type TaskStatus } from "../../../entities/task";

export type InboxAgent = { id: string; machine_id: string };
// unread: 1 when the Agent answered after what this device last had on screen (`markRead`).
export type InboxTask = Latest & { id: string; agent_id: string; updated_at: number; unread?: number };

// The prototype's order: an Approval waiting or a Turn a restart cut off needs a person, so it comes
// first; then a Turn still running; then the finished ones, by time; then the ones never started.
const ORDER: Record<TaskStatus, number> = { waiting: 0, interrupted: 0, stuck: 0, working: 1, failed: 2, done: 2, new: 3, offline: 4 };

/** How many more of an Agent's open Tasks show under its row; the rest are a swipe away, in the sheet of all its Tasks. */
const MORE = 3;

/**
 * One row per Agent, as the prototype's Inbox has it, working ones first, then by when they last moved.
 * An Agent runs Turns of several Tasks at once (ADR 0080), so its row stands for the Task that most needs
 * a person, of its open ones and its latest: an Approval in an older Task is not hidden behind a newer chat.
 * `open` lists its other open Tasks the same way, at most three: running or waiting first, then finished ones
 * with an answer not read yet, which the open list also carries. A row with no Task opens a new one.
 */
export function inboxRows<A extends InboxAgent, T extends InboxTask>(agents: A[], latest: T[], open: T[], online: (machine: string) => boolean | null) {
  return agents
    .map((agent) => {
      const on = online(agent.machine_id);
      const mine = open.filter((t) => t.agent_id === agent.id);
      // A round that had nothing to tell is not news: the row shows the Task before it.
      const newest = latest.filter((t) => t.agent_id === agent.id && !isQuiet(t)).sort((a, b) => b.updated_at - a.updated_at)[0];
      const ranked = (newest && !mine.some((t) => t.id === newest.id) ? [...mine, newest] : mine)
        .map((task) => ({ task, status: statusOf(task, on) }))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.task.updated_at - a.task.updated_at);
      const [head, ...rest] = ranked;
      return {
        agent,
        task: head?.task,
        status: head?.status ?? statusOf(undefined, on),
        open: rest.filter((row) => mine.includes(row.task)).slice(0, MORE),
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.task?.updated_at ?? 0) - (a.task?.updated_at ?? 0));
}

/** The Inbox's tabs, by what the Owner has to do (screens-redesign). */
export type InboxTab = "all" | "needsYou" | "working" | "done";

/** Which tab an Agent shows in besides All: one waiting on an Approval, failed or interrupted needs its Owner; one not started or offline is in All only. */
export function tabOf(status: TaskStatus): Exclude<InboxTab, "all"> | null {
  if (needsYou(status)) return "needsYou";
  if (status === "working") return "working";
  if (status === "done") return "done";
  return null;
}

/** The rows a tab shows, in the All tab's order. */
export const rowsOf = <R extends { status: TaskStatus }>(rows: R[], tab: InboxTab) => (tab === "all" ? rows : rows.filter((row) => tabOf(row.status) === tab));

/** How many rows each tab would show. */
export const countsOf = (rows: { status: TaskStatus }[]) => ({ needsYou: rowsOf(rows, "needsYou").length, working: rowsOf(rows, "working").length });
