import type { CharacterKey } from "@/src/shared/ui";

export interface Machine {
  id: string;
  os: string;
  runtime: string;
  online: boolean;
  egress: string[];
}

export interface Agent {
  id: string;
  character: CharacterKey;
  machine: Machine;
  workdir: string;
  allowlist: string[];
  expiryMinutes: number;
  delegatesTo: string[];
  pinned?: boolean;
}

const macStudio: Machine = { id: "mac-studio", os: "macOS 26", runtime: "0.1.3", online: true, egress: ["api.anthropic.com", "github.com", "registry.npmjs.org"] };
const buildBox: Machine = { id: "build-box", os: "Ubuntu 24.04", runtime: "0.1.2", online: true, egress: ["openrouter.ai", "github.com", "registry.npmjs.org"] };
const officePc: Machine = { id: "office-pc", os: "Windows 11 · WSL2", runtime: "0.1.3", online: false, egress: ["api.anthropic.com"] };

// ponytail: fixtures until Agents come from SQLite (ADR 0021); they become the Demo Workspace (ADR 0024).
const AGENTS: Agent[] = [
  { id: "deployer", character: "egg", machine: macStudio, workdir: "~/work/shop", allowlist: ["read", "write", "test"], expiryMinutes: 60, delegatesTo: ["builder"], pinned: true },
  { id: "reviewer", character: "sprout", machine: macStudio, workdir: "~/work/shop", allowlist: ["read", "test"], expiryMinutes: 60, delegatesTo: ["deployer"], pinned: true },
  { id: "builder", character: "bear", machine: buildBox, workdir: "~/build", allowlist: ["read", "write", "test", "bash"], expiryMinutes: 60, delegatesTo: ["tester"], pinned: true },
  { id: "tester", character: "bean", machine: buildBox, workdir: "~/build", allowlist: ["read", "test"], expiryMinutes: 60, delegatesTo: [] },
  { id: "writer", character: "pebble", machine: officePc, workdir: "~/docs", allowlist: ["read", "write"], expiryMinutes: 240, delegatesTo: [] },
  { id: "janitor", character: "ghost", machine: macStudio, workdir: "~/ops", allowlist: ["read", "write"], expiryMinutes: 15, delegatesTo: [] },
];

export function useAgents() {
  return AGENTS;
}

export function useAgent(id: string) {
  return AGENTS.find((agent) => agent.id === id);
}

export function delegatesFrom(id: string) {
  return AGENTS.filter((agent) => agent.delegatesTo.includes(id)).map((agent) => agent.id);
}
