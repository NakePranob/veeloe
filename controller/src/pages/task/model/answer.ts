import { answersFromInbox, type Latest } from "../../../entities/task";

/**
 * The next Task the answer sheet moves to once this one is answered (ADR 0092): another open Task waiting on an
 * Approval this Member can answer, the one waiting longest first. Null when there is none, and the sheet closes.
 */
export function nextToAnswer<T extends Latest & { id: string; agent_id: string; updated_at: number }>(open: readonly T[], current: string, levelOf: (agent: string) => string | undefined): T | null {
  return open.filter((task) => task.id !== current && answersFromInbox(task, levelOf(task.agent_id))).sort((a, b) => a.updated_at - b.updated_at)[0] ?? null;
}
