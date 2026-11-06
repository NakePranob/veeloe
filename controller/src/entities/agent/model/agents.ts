import type { Agent } from "@veeloe/protocol";
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
};

export const LIST_AGENTS = "SELECT * FROM agent ORDER BY name, id";

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
 * What a Machine said it has. v0.1 never deletes an Agent, so this only adds and
 * updates, and a field the answer did not carry keeps what is kept (`daily-budget`).
 */
export function saveAgents(database: Database, machineId: string, agents: Agent[]) {
  return database.write([AGENT_TOPIC], async (transaction) => {
    for (const agent of agents) {
      await transaction.run(
        `INSERT INTO agent (id, machine_id, name, provider, model, character, budget) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           machine_id = excluded.machine_id,
           name = excluded.name,
           provider = excluded.provider,
           model = excluded.model,
           character = COALESCE(excluded.character, agent.character),
           budget = COALESCE(excluded.budget, agent.budget)`,
        [agent.id, machineId, agent.name, agent.provider, agent.model, agent.character ? JSON.stringify(agent.character) : null, agent.budget ?? null],
      );
      if (agent.usage) await writeUsage(transaction, { agent: agent.id, ...agent.usage });
    }
  });
}

/** Today's tally as `agent.usage` said it, kept only when it is not older than what is there. */
export function saveUsage(database: Database, usage: AgentUsage) {
  return database.write([AGENT_TOPIC], (transaction) => writeUsage(transaction, usage));
}
