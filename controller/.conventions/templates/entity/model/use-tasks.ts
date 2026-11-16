import { useLiveQuery } from "../../../shared/db";
import { LIST_TASK_SUMMARIES, TASK_TOPIC, type PendingRow, type TaskEventRow, type TaskRow, type TaskSummary } from "./tasks";

const TOPICS = [TASK_TOPIC];

/** Every Task, newest first. Null until the first read lands. */
export function useTaskSummaries() {
  return useLiveQuery<TaskSummary>(LIST_TASK_SUMMARIES, [], TOPICS);
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
