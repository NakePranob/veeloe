import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import { supervisorDir } from "../config";
import { readJsonFile, writeJsonFile } from "../json-file";
import type { Provider } from "../providers/store";
import type { Route } from "./proxy";

type Pin = { provider: string; model: string };

/**
 * The Provider and model each Task started on, kept in `task-routes.json` so a
 * change to the Agent reaches only its next Tasks, across restarts too (ADR 0042).
 * A Task whose pinned Provider is gone moves to the Agent's current one, since
 * the old one cannot answer anyway (`agent-settings`).
 *
 * One line per Task, kept until something says the Task is gone: `forget` is
 * what `delete-agent` will call. A line for an Agent this Machine no longer has
 * is dropped at startup by `prune`, so an unpaired and re-paired Machine does
 * not carry the old Workspace's ids forever.
 */
export function createTaskRoutes(home: string) {
  const file = join(supervisorDir(home), "task-routes.json");
  const value = readJsonFile(file);
  // Maps, because a Task id comes from a worker and may be any string, `__proto__` included.
  const pins = new Map<string, Map<string, Pin>>(
    value && typeof value === "object" ? Object.entries(value as Record<string, Record<string, Pin>>).map(([agent, tasks]) => [agent, new Map(Object.entries(tasks))]) : [],
  );
  const save = () => writeJsonFile(file, Object.fromEntries([...pins].map(([agent, tasks]) => [agent, Object.fromEntries(tasks)])));

  function route(agent: Agent, task: string | undefined, providers: Provider[]): Route {
    const pinned = task === undefined ? undefined : pins.get(agent.id)?.get(task);
    const kept = pinned && providers.find((p) => p.name === pinned.provider);
    if (pinned && kept) return { provider: kept, model: pinned.model };
    const provider = providers.find((p) => p.name === agent.provider);
    if (!provider) return { error: "provider.missing" };
    if (task !== undefined) {
      pins.set(agent.id, (pins.get(agent.id) ?? new Map<string, Pin>()).set(task, { provider: agent.provider, model: agent.model }));
      save();
    }
    return { provider, model: agent.model };
  }

  /** Drops one Task's line, for the Task that is being deleted. */
  route.forget = (agentId: string, task: string) => {
    const tasks = pins.get(agentId);
    if (!tasks?.delete(task)) return;
    if (tasks.size === 0) pins.delete(agentId);
    save();
  };

  /** Drops the lines of Agents this Machine does not have, so nothing outlives its Agent. */
  route.prune = (agentIds: readonly string[]) => {
    const known = new Set(agentIds);
    let dropped = false;
    for (const agentId of [...pins.keys()]) {
      if (known.has(agentId)) continue;
      pins.delete(agentId);
      dropped = true;
    }
    if (dropped) save();
  };

  return route;
}
