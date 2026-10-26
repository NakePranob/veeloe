export interface Machine {
  name: string;
  online: boolean;
}

export interface Agent {
  id: string;
  name: string;
  machine: Machine;
  // The Character's colour; the Hub keeps it next to the Agent's name (ADR 0006).
  color: string;
}

const macStudio: Machine = { name: "mac-studio", online: true };
const buildBox: Machine = { name: "build-box", online: true };
const officePc: Machine = { name: "office-pc", online: false };

// ponytail: the Demo Workspace's Agents (ADR 0024), in memory until they come from SQLite (ADR 0021).
const AGENTS: Agent[] = [
  { id: "deployer", name: "Deployer", machine: macStudio, color: "#F4B183" },
  { id: "reviewer", name: "Reviewer", machine: macStudio, color: "#9DC3E6" },
  { id: "tester", name: "Tester", machine: buildBox, color: "#A9D18E" },
  { id: "writer", name: "Writer", machine: officePc, color: "#C9B3E6" },
];

export function useAgents() {
  return AGENTS;
}

export function useAgent(id: string | undefined) {
  return AGENTS.find((agent) => agent.id === id);
}
