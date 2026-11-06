import { shiftDay } from "../../../shared/lib/days";

/** One Agent's tokens on one Budget day, as the Machine reported them. */
export type UsageRow = { agent_id: string; day: string; tokens: number };

/** Every Budget day from `from` to `to`, both ends included, so a gap can be drawn as a gap. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

export function totalOf(rows: readonly UsageRow[]): number {
  let total = 0;
  for (const row of rows) total += row.tokens;
  return total;
}

/** The rows in one Machine's own Budget range, for the Agents it holds. */
export function rowsInRange(rows: readonly UsageRow[], agentIds: ReadonlySet<string>, from: string, to: string): UsageRow[] {
  return rows.filter((row) => agentIds.has(row.agent_id) && row.day >= from && row.day <= to);
}
