import { useLiveQuery } from "../../../shared/db";
import { COUNT_AGENT_TASKS, LIST_AGENT_TASK_SUMMARIES, LIST_LATEST_TASKS, LIST_THREAD_HEADS, LIST_TRIGGER_ROUNDS, TASK_TOPIC, type PendingRow, type TaskEventRow, type TaskRow, type TaskSummary } from "./tasks";

const TOPICS = [TASK_TOPIC];

/** One Agent's newest `limit` Tasks: grow `limit` to read the next page. */
export function useAgentTaskSummaries(agentId: string, limit: number) {
  return useLiveQuery<TaskSummary>(LIST_AGENT_TASK_SUMMARIES, [agentId, limit], TOPICS);
}

/** How many Tasks one Agent has, without reading them. */
export function useAgentTaskCount(agentId: string) {
  return useLiveQuery<{ count: number }>(COUNT_AGENT_TASKS, [agentId], TOPICS)?.[0]?.count ?? null;
}

/** Each Agent's newest Task that is news: what the Inbox, Agents and Machine pages show. */
export function useLatestTasks() {
  return useLiveQuery<TaskSummary>(LIST_LATEST_TASKS, [], TOPICS);
}

/** The newest round of each of one Agent's Triggers, with its round count; `hideDeleted` leaves out threads deleted on this device. */
export function useThreadHeads(agentId: string, hideDeleted: boolean) {
  return useLiveQuery<TaskSummary & { rounds: number }>(LIST_THREAD_HEADS, [agentId, hideDeleted ? 1 : 0], TOPICS);
}

/** Every round of one Trigger, newest first. */
export function useTriggerRounds(trigger: string) {
  return useLiveQuery<TaskSummary>(LIST_TRIGGER_ROUNDS, [trigger], TOPICS);
}

/** These Tasks only, in no order. */
export function useTasksByIds(ids: readonly string[]) {
  return useLiveQuery<TaskSummary>(`SELECT * FROM task WHERE id IN (${ids.map(() => "?").join(", ") || "NULL"})`, [...ids], TOPICS);
}

export function useTaskEvents(taskId: string) {
  return useLiveQuery<TaskEventRow>("SELECT * FROM task_event WHERE task_id = ? ORDER BY seq", [taskId], TOPICS);
}

/** The Task's own row, which still names its Machine after the Agent is gone. */
export function useTaskRow(taskId: string) {
  return useLiveQuery<TaskRow>("SELECT * FROM task WHERE id = ?", [taskId], TOPICS);
}

export function usePendingMessages(taskId: string) {
  return useLiveQuery<PendingRow>("SELECT * FROM pending_message WHERE task_id = ? ORDER BY created_at", [taskId], TOPICS);
}

/** The ids of threads deleted on this device (ADR 0061). */
export function useHiddenThreads() {
  return useLiveQuery<{ trigger_id: string }>("SELECT trigger_id FROM thread_hidden", [], TOPICS);
}
