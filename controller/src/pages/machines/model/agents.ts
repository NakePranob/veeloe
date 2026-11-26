import { needsYou, type TaskStatus } from "../../../entities/task";

/** The Machine board's groups: who needs the Owner first, then who is working, then the rest. */
export type Group = "needsYou" | "working" | "idle";

export const groupOf = (status: TaskStatus): Group => (needsYou(status) ? "needsYou" : status === "working" ? "working" : "idle");

/** Past this many Agents the board shows only the first ones, a search box and "see all". */
export const SHOWN = 6;

/** In the board's order (needs you, working, the rest), keeping each group's own order. */
export function ordered<R extends { status: TaskStatus }>(rows: R[]): R[] {
  const rank: Record<Group, number> = { needsYou: 0, working: 1, idle: 2 };
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank[groupOf(a.row.status)] - rank[groupOf(b.row.status)] || a.i - b.i)
    .map(({ row }) => row);
}

/** How many Agents are in each group. */
export function countsOf(rows: { status: TaskStatus }[]): Record<Group, number> {
  const counts: Record<Group, number> = { needsYou: 0, working: 0, idle: 0 };
  for (const row of rows) counts[groupOf(row.status)]++;
  return counts;
}

/** Today's share of an Agent's Budget, 0..1, or null before a Machine has said its Budget. */
export const shareOf = (used: number | null, budget: number | null) => (budget ? (used ?? 0) / budget : null);
