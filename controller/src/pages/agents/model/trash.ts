import type { AgentTrashRow } from "../../../entities/agent";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * How many whole days are left before the Machine purges a deleted Agent
 * (`agent-trash`). A day counts while any of it is left, so the last day reads 1
 * rather than 0, and a row the Machine has not purged yet never reads negative.
 * The answer never exceeds the window the Machine granted (`restoreUntil -
 * deletedAt`, 30 days): the two clocks differ by milliseconds, and a reading
 * before the Machine's own `deletedAt` would otherwise round up to 31.
 */
export function daysLeft(row: Pick<AgentTrashRow, "deleted_at" | "restore_until">, now: number): number {
  const window = Math.max(0, Math.ceil((row.restore_until - row.deleted_at) / DAY_MS));
  return Math.min(window, Math.max(0, Math.ceil((row.restore_until - now) / DAY_MS)));
}
