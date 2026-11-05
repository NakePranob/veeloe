import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import { supervisorDir } from "../config";
import { readJsonFile, writeJsonFile } from "../json-file";

/** The Agents on this Machine, in the supervisor's own file (ADR 0020). */
export function createAgentRegistry(home: string) {
  const file = join(supervisorDir(home), "agents.json");
  const value = readJsonFile(file);
  let agents: Agent[] = Array.isArray(value) ? (value as Agent[]) : [];
  return {
    all: () => agents,
    get: (id: string) => agents.find((a) => a.id === id),
    add(agent: Agent) {
      agents = [...agents, agent];
      writeJsonFile(file, agents);
    },
    /** The Agent with this id, changed, in one write of the whole file. */
    replace(agent: Agent) {
      agents = agents.map((a) => (a.id === agent.id ? agent : a));
      writeJsonFile(file, agents);
    },
  };
}
export type AgentRegistry = ReturnType<typeof createAgentRegistry>;

/**
 * `<VEELOE_HOME>/agents/<id>/` with its Workdir and its TMPDIR (ADR 0032). The
 * Runtime picks the place; the id was checked to be a plain folder name.
 */
export function agentDir(home: string, id: string) {
  const dir = join(home, "agents", id);
  for (const sub of ["workdir", "tmp"]) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
  return dir;
}
