import { useLiveQuery } from "../../../shared/db";
import { TASK_TOPIC, type PendingRow, type TaskEventRow, type TaskRow } from "./tasks";

const TOPICS = [TASK_TOPIC];

/** Newest first. Null until the first read lands. */
export function useAgentTasks(agentId: string) {
  return useLiveQuery<TaskRow & { preview: string | null }>(
    `SELECT t.*, (SELECT json_extract(body, '$.text') FROM task_event e WHERE e.task_id = t.id AND e.kind = 'member.message' ORDER BY seq LIMIT 1) AS preview
     FROM task t WHERE t.agent_id = ? ORDER BY t.updated_at DESC`,
    [agentId],
    TOPICS,
  );
}

export function useTaskEvents(taskId: string) {
  return useLiveQuery<TaskEventRow>("SELECT * FROM task_event WHERE task_id = ? ORDER BY seq", [taskId], TOPICS);
}

export function usePendingMessages(taskId: string) {
  return useLiveQuery<PendingRow>("SELECT * FROM pending_message WHERE task_id = ? ORDER BY created_at", [taskId], TOPICS);
}
