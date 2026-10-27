export interface Machine {
  name: string;
  online: boolean;
}

// A Character is a floating robot head: a shell with a screen, and one part in each of its three sockets.
export type Shell = "box" | "capsule" | "dome" | "chamfer";
export type Top = "none" | "antenna" | "twin" | "fin" | "beacon";
export type Sides = "none" | "ears" | "pods" | "fins";
export type Decal = "none" | "brow" | "lights" | "grille";

export interface Agent {
  id: string;
  name: string;
  machine: Machine;
  // The Character's colour; the Hub keeps it next to the Agent's name (ADR 0006).
  color: string;
  // ponytail: only the Demo Workspace has these; the Hub will keep them next to the colour.
  shell: Shell;
  top: Top;
  sides: Sides;
  decal: Decal;
}

const macStudio: Machine = { name: "mac-studio", online: true };
const buildBox: Machine = { name: "build-box", online: true };
const officePc: Machine = { name: "office-pc", online: false };

// ponytail: the Demo Workspace's Agents (ADR 0024), in memory until they come from SQLite (ADR 0021).
const AGENTS: Agent[] = [
  { id: "deployer", name: "Deployer", machine: macStudio, color: "#F4B183", shell: "chamfer", top: "beacon", sides: "ears", decal: "grille" },
  { id: "reviewer", name: "Reviewer", machine: macStudio, color: "#9DC3E6", shell: "dome", top: "antenna", sides: "pods", decal: "none" },
  { id: "tester", name: "Tester", machine: buildBox, color: "#A9D18E", shell: "box", top: "twin", sides: "none", decal: "lights" },
  { id: "writer", name: "Writer", machine: officePc, color: "#C9B3E6", shell: "capsule", top: "fin", sides: "fins", decal: "brow" },
];

export function useAgents() {
  return AGENTS;
}

export function useAgent(id: string | undefined) {
  return AGENTS.find((agent) => agent.id === id);
}
