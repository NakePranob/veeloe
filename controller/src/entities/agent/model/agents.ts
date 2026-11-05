import type { Agent } from "@veeloe/protocol";
import type { Database } from "../../../shared/db";

export const AGENT_TOPIC = "agent";

/** An Agent as this Controller knows it. The columns are the database's own; `character` is the Machine's JSON, or null. */
export type AgentRow = { id: string; machine_id: string; name: string; provider: string; model: string; character: string | null };

export const LIST_AGENTS = "SELECT * FROM agent ORDER BY name, id";

/** What a Machine said it has. v0.1 never deletes an Agent, so this only adds and updates. */
export function saveAgents(database: Database, machineId: string, agents: Agent[]) {
  return database.write([AGENT_TOPIC], async (transaction) => {
    for (const agent of agents) {
      await transaction.run("INSERT OR REPLACE INTO agent (id, machine_id, name, provider, model, character) VALUES (?, ?, ?, ?, ?, ?)", [
        agent.id,
        machineId,
        agent.name,
        agent.provider,
        agent.model,
        agent.character ? JSON.stringify(agent.character) : null,
      ]);
    }
  });
}
