import { useSyncExternalStore } from "react";
import type { Look } from "./look";

export interface Machine {
  name: string;
  online: boolean;
}

export interface Agent {
  id: string;
  name: string;
  machine: Machine;
  // How its Character looks; the Hub keeps it next to the Agent's name (ADR 0006).
  // ponytail: only the Demo Workspace has looks until the Hub has Agents (#11).
  character: Look;
}

const macStudio: Machine = { name: "mac-studio", online: true };
const buildBox: Machine = { name: "build-box", online: true };
const officePc: Machine = { name: "office-pc", online: false };

// ponytail: a module-level store over the Demo Workspace's Agents (ADR 0024), as the Task store is.
// Screens move to SQLite live queries (ADR 0021) behind these same hooks.
let agents: Agent[] = [
  { id: "deployer", name: "Deployer", machine: macStudio, character: { color: "#F4B183", shell: "chamfer", top: "beacon", sides: "ears", decal: "grille" } },
  { id: "reviewer", name: "Reviewer", machine: macStudio, character: { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "pods", decal: "none" } },
  { id: "tester", name: "Tester", machine: buildBox, character: { color: "#A9D18E", shell: "box", top: "twin", sides: "none", decal: "lights" } },
  { id: "writer", name: "Writer", machine: officePc, character: { color: "#C9B3E6", shell: "capsule", top: "fin", sides: "fins", decal: "brow" } },
];

const listeners = new Set<() => void>();

export function subscribeAgents(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAgents() {
  return agents;
}

export function useAgents() {
  return useSyncExternalStore(subscribeAgents, getAgents, getAgents);
}

export function useAgent(id: string | undefined) {
  return useAgents().find((agent) => agent.id === id);
}

// The whole look changes at once, as one message to the Hub will (ADR 0006). The Demo Workspace
// keeps it on this device: nothing is sent (CONTEXT.md).
export function updateCharacter(id: string, character: Look) {
  agents = agents.map((agent) => (agent.id === id ? { ...agent, character } : agent));
  listeners.forEach((listener) => listener());
}
