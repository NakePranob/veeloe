import type { Agent, AgentTrashEntry } from "@veeloe/protocol-ts";
import type { Database, WriteTransaction } from "../../../shared/db";

export const AGENT_TOPIC = "agent";

/** An Agent as this Controller knows it. The columns are the database's own; `character` is the Machine's JSON, or null. */
export type AgentRow = {
  id: string;
  machine_id: string;
  name: string;
  provider: string;
  model: string;
  character: string | null;
  /** Null until a Machine that knows of Budgets answers (`daily-budget`). */
  budget: number | null;
  usage_day: string | null;
  usage_tokens: number | null;
  /** The Allowlist as JSON, or null from a Machine older than `approval-and-allowlist`. */
  allowlist: string | null;
  /** How long one Approval waits, in seconds, or null from a Machine older than `approval-and-allowlist`. */
  approval_timeout_s: number | null;
};

/** The Approval timeout the Machine last sent, in seconds, or null when it never sent one. */
export function approvalTimeoutOf(row: Pick<AgentRow, "approval_timeout_s">): number | null {
  return typeof row.approval_timeout_s === "number" ? row.approval_timeout_s : null;
}

/** The Allowlist the Machine last sent, or null when it never sent one. Broken JSON reads as an empty list. */
export function allowlistOf(row: Pick<AgentRow, "allowlist">): string[] | null {
  if (row.allowlist === null) return null;
  try {
    const parsed: unknown = JSON.parse(row.allowlist);
    return Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export const LIST_AGENTS = "SELECT * FROM agent ORDER BY name, id";

/** An Agent the Machine deleted but has not purged, as it last said (`agent-trash`). */
export type AgentTrashRow = {
  id: string;
  machine_id: string;
  name: string;
  provider: string;
  model: string;
  /** The Character as the Machine kept it, as JSON, or null from a Machine older than Characters. */
  character: string | null;
  /** Epoch milliseconds, from the Machine. */
  deleted_at: number;
  /** Epoch milliseconds, from the Machine: when it purges the row. */
  restore_until: number;
};

export const LIST_TRASHED_AGENTS = "SELECT * FROM agent_trash ORDER BY deleted_at, id";

/** The Agent's daily token Budget, todays tally: both from `daily-budget` (ADR 0043). */
export type AgentUsage = { agent: string; day: string; tokens: number };

/**
 * An older day, or a lower tally of the same day, never replaces what is kept:
 * `agent.usage` and `agent.listed` can arrive out of order (`daily-budget`).
 */
function writeUsage(transaction: WriteTransaction, { agent, day, tokens }: AgentUsage) {
  return transaction.run(
    "UPDATE agent SET usage_day = ?, usage_tokens = ? WHERE id = ? AND (usage_day IS NULL OR ? > usage_day OR (? = usage_day AND ? >= usage_tokens))",
    [day, tokens, agent, day, day, tokens],
  );
}

/**
 * What a Machine said it has: add and update, then drop the Agents it no longer
 * lists for that Machine. A field the answer did not carry keeps what is kept.
 */
export function saveAgents(database: Database, machineId: string, agents: Agent[], trash?: AgentTrashEntry[]) {
  return database.write([AGENT_TOPIC], async (transaction) => {
    for (const agent of agents) {
      await transaction.run(
        `INSERT INTO agent (id, machine_id, name, provider, model, character, budget, allowlist, approval_timeout_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           machine_id = excluded.machine_id,
           name = excluded.name,
           provider = excluded.provider,
           model = excluded.model,
           character = COALESCE(excluded.character, agent.character),
           budget = COALESCE(excluded.budget, agent.budget),
           allowlist = COALESCE(excluded.allowlist, agent.allowlist),
           approval_timeout_s = COALESCE(excluded.approval_timeout_s, agent.approval_timeout_s)`,
        [agent.id, machineId, agent.name, agent.provider, agent.model, agent.character ? JSON.stringify(agent.character) : null, agent.budget ?? null, agent.allowlist ? JSON.stringify(agent.allowlist) : null, agent.approvalTimeoutS ?? null],
      );
      if (agent.usage) await writeUsage(transaction, { agent: agent.id, ...agent.usage });
    }
    const active = agents.map((agent) => agent.id);
    if (active.length === 0) await transaction.run("DELETE FROM agent WHERE machine_id = ?", [machineId]);
    else await transaction.run(`DELETE FROM agent WHERE machine_id = ? AND id NOT IN (${active.map(() => "?").join(", ")})`, [machineId, ...active]);

    // The trash of this Machine, as the answer said it. A Machine too old to keep
    // deleted Agents sends no `trash` at all, and then it has none (`agent-trash`).
    if (trash === undefined) {
      await transaction.run("DELETE FROM agent_trash WHERE machine_id = ?", [machineId]);
      return;
    }
    for (const entry of trash) {
      await transaction.run(
        `INSERT INTO agent_trash (id, machine_id, name, provider, model, character, deleted_at, restore_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           machine_id = excluded.machine_id,
           name = excluded.name,
           provider = excluded.provider,
           model = excluded.model,
           character = COALESCE(excluded.character, agent_trash.character),
           deleted_at = excluded.deleted_at,
           restore_until = excluded.restore_until`,
        [entry.id, machineId, entry.name, entry.provider, entry.model, entry.character ? JSON.stringify(entry.character) : null, entry.deletedAt, entry.restoreUntil],
      );
    }
    const trashed = trash.map((entry) => entry.id);
    if (trashed.length === 0) await transaction.run("DELETE FROM agent_trash WHERE machine_id = ?", [machineId]);
    else await transaction.run(`DELETE FROM agent_trash WHERE machine_id = ? AND id NOT IN (${trashed.map(() => "?").join(", ")})`, [machineId, ...trashed]);
    // One id is in one list only: an Agent the Machine says is in use is not in its trash.
    if (active.length > 0) await transaction.run(`DELETE FROM agent_trash WHERE id IN (${active.map(() => "?").join(", ")})`, active);
  });
}

/** Today's tally as `agent.usage` said it, kept only when it is not older than what is there. */
export function saveUsage(database: Database, usage: AgentUsage) {
  return database.write([AGENT_TOPIC], (transaction) => writeUsage(transaction, usage));
}
