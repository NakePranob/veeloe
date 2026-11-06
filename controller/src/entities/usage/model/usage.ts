import type { UsageListedBody } from "@veeloe/protocol";
import type { Database } from "../../../shared/db";
import { shiftDay } from "../../../shared/lib/days";

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
