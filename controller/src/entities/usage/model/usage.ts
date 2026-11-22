import type { UsageListedBody } from "@veeloe/protocol-ts";
import type { Database } from "../../../shared/db";
import { shiftDay } from "../../../shared/lib";

export const USAGE_TOPIC = "usage";

/** One Agent's tokens on one Budget day. Days the Machine did not report are absent, never 0. */
export type UsageDayRow = { agent_id: string; day: string; tokens: number };

/** The page's live rows: every day of every Agent, with the Agent it belongs to. */
export const LIST_USAGE_DAYS = "SELECT agent_id, day, tokens FROM usage_day ORDER BY day, agent_id";

/** How many Budget days the Machine keeps; the Controller keeps no longer than it can ask for (`usage-history`). */
export const USAGE_KEEP_DAYS = 30;

/**
 * What a Machine answered for a range, before anything shows it. The Machine is
 * authoritative for the whole range it chose, so the Machine's cached range is
 * replaced: a day that is gone or corrected leaves. Days older than the history
 * it keeps are dropped here too.
 */
export function saveUsageHistory(database: Database, machineId: string, body: UsageListedBody) {
  const before = shiftDay(body.to, -(USAGE_KEEP_DAYS - 1));
  return database.write([USAGE_TOPIC], async (transaction) => {
    const onThisMachine = "agent_id IN (SELECT id FROM agent WHERE machine_id = ?)";
    // Clear the answered range first: a day the Machine no longer reports, or corrected, must not stay behind.
    await transaction.run(`DELETE FROM usage_day WHERE ${onThisMachine} AND day >= ? AND day <= ?`, [machineId, body.from, body.to]);
    for (const agent of body.agents) {
      for (const day of agent.days) {
        await transaction.run("INSERT INTO usage_day (agent_id, day, tokens) VALUES (?, ?, ?) ON CONFLICT(agent_id, day) DO UPDATE SET tokens = excluded.tokens", [agent.agent, day.day, day.tokens]);
      }
    }
    // An Agent with nothing in the range is left out of the answer, so prune every Agent on this Machine.
    await transaction.run(`DELETE FROM usage_day WHERE ${onThisMachine} AND day < ?`, [machineId, before]);
  });
}

/** When this Machine last answered a usage request, so the page can say how old its numbers are. */
export function saveUsageFetchedAt(database: Database, machineId: string, at: number) {
  return database.write(["machine"], (transaction) => transaction.run("UPDATE machine SET usage_fetched_at = ? WHERE id = ?", [at, machineId]));
}

/**
 * Each Budget day from `from` to `to`, both ends included, with the tokens the given Agents used on it. A day
 * no row reports is `known: false`, so a gap can be drawn as a gap rather than a 0.
 */
export function dailyTotals(rows: readonly UsageDayRow[], agentIds: ReadonlySet<string>, from: string, to: string): { day: string; tokens: number; known: boolean }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) if (agentIds.has(row.agent_id) && row.day >= from && row.day <= to) byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.tokens);
  const days = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push({ day, tokens: byDay.get(day) ?? 0, known: byDay.has(day) });
  return days;
}

/**
 * Each Agent's tokens from `from` to `to`, both ends included: the same rows and days `dailyTotals` counts, so a
 * breakdown by Agent or Machine always adds up to the chart above it (`controller-usage`). An Agent with no row is absent.
 */
export function agentTotals(rows: readonly UsageDayRow[], from: string, to: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) if (row.day >= from && row.day <= to) totals.set(row.agent_id, (totals.get(row.agent_id) ?? 0) + row.tokens);
  return totals;
}
