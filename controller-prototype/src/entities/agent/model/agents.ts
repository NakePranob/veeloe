import { createStore } from "../../../shared/lib";
import type { Look } from "./look";

// Set by Owner on a Machine; the supervisor holds the key (ADR 0042).
export interface Provider {
  id: string;
  name: string;
  url: string;
  // The last characters only: the key itself is sealed to the Machine (ADR 0005).
  keyHint: string;
  models: string[];
  contextSize: number;
}

export interface Machine {
  id: string;
  name: string;
  os: "macOS" | "Linux" | "WSL2";
  online: boolean;
  version: string;
  // What this Runtime has, so screens can hide the rest (ADR 0022, 0052).
  features: string[];
  lastError?: string;
  diskFreeGb: number;
  providers: Provider[];
  // One list for the whole Machine until v0.3 splits it per Agent (ADR 0008, 0029).
  egress: string[];
}

export type UsageSource = "Task" | "Schedule" | "Idle Work" | "Watch" | "Channel";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  machineId: string;
  // Joined from machineId.
  machine: Machine;
  character: Look;
  providerId: string;
  model: string;
  // Bash prefixes and Connector tools that need no Approval (ADR 0030).
  allowlist: string[];
  // Tokens a day (ADR 0043).
  budget: number;
  usedToday: number;
  // Idle Work and Watch together, as a percentage of the Budget (ADR 0056).
  backgroundPercent: number;
  approvalMinutes: number;
  memory: string;
  // Who used what this month, by Member and by source.
  usageByMember: Record<string, number>;
  usageBySource: Partial<Record<UsageSource, number>>;
  // Search of other Members' Tasks, frozen at each Task's start (ADR 0060).
  searchOtherTasks: boolean;
}

type AgentRecord = Omit<Agent, "machine">;

const FEATURES = ["pairing", "linking", "revocation", "task-message", "attachment", "approval-answer", "stop", "agent-config", "sync", "logs"];
const anthropic: Provider = { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com", keyHint: "…x4Qa", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], contextSize: 1_000_000 };
const openrouter: Provider = { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api", keyHint: "…77fd", models: ["anthropic/claude-sonnet-5-5", "z-ai/glm-5"], contextSize: 128_000 };

const machines = createStore<Machine[]>([
  { id: "mac-studio", name: "mac-studio", os: "macOS", online: true, version: "0.1.4", features: FEATURES, diskFreeGb: 412, providers: [anthropic, openrouter], egress: ["github.com", "registry.npmjs.org"] },
  { id: "build-box", name: "build-box", os: "Linux", online: true, version: "0.1.4", features: FEATURES, diskFreeGb: 88, providers: [anthropic], egress: ["github.com", "registry.npmjs.org", "ghcr.io"] },
  { id: "office-pc", name: "office-pc", os: "WSL2", online: false, version: "0.1.3", features: FEATURES, lastError: "Provider ตอบ 401: key หมดอายุ", diskFreeGb: 23, providers: [anthropic], egress: ["github.com"] },
]);

const READ_ONLY = ["ls", "pwd", "cat", "head", "tail", "wc", "git status", "git diff", "git log"];

function seed(id: string, name: string, description: string, machineId: string, character: Look, usedToday: number, extra: string[] = []): AgentRecord {
  return {
    id,
    name,
    description,
    instructions: `คุณคือ ${name} ${description}`,
    machineId,
    character,
    providerId: "anthropic",
    model: "claude-sonnet-5-5",
    allowlist: [...READ_ONLY, ...extra],
    budget: 10_000_000,
    usedToday,
    backgroundPercent: 30,
    approvalMinutes: 60,
    memory: "- ใช้ภาษาไทยเวลาตอบ\n- deploy ต้องผ่าน test ก่อนเสมอ\n",
    usageByMember: { m_kai: usedToday * 18, m_nok: usedToday * 4 },
    usageBySource: { Task: usedToday },
    searchOtherTasks: true,
  };
}

const agents = createStore<AgentRecord[]>([
  seed("deployer", "Deployer", "ดูแลการ deploy ขึ้น production", "mac-studio", { color: "#F4B183", shell: "chamfer", top: "beacon", sides: "ears", decal: "grille" }, 2_400_000, ["npm test"]),
  seed("reviewer", "Reviewer", "รีวิว PR และเช็ก performance", "mac-studio", { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "pods", decal: "none" }, 1_100_000, ["gh pr diff", "rg"]),
  seed("tester", "Tester", "รัน test และ e2e", "build-box", { color: "#A9D18E", shell: "box", top: "twin", sides: "none", decal: "lights" }, 7_900_000, ["bun run"]),
  seed("writer", "Writer", "เขียนเอกสารและ release notes", "office-pc", { color: "#C9B3E6", shell: "capsule", top: "fin", sides: "fins", decal: "brow" }, 300_000),
]);

// An Agent that did not change stays the same object, so a change to one never redraws the others.
const cache = new WeakMap<AgentRecord, Agent>();
const joined = createStore<Agent[]>([]);
function join() {
  joined.set(agents.get().flatMap((agent) => {
    const machine = machines.get().find((candidate) => candidate.id === agent.machineId);
    if (!machine) return [];
    const cached = cache.get(agent);
    if (cached?.machine === machine) return [cached];
    const fresh = { ...agent, machine };
    cache.set(agent, fresh);
    return [fresh];
  }));
}
agents.subscribe(join);
machines.subscribe(join);
join();

export const getAgents = joined.get;
export const subscribeAgents = joined.subscribe;
export const useAgents = joined.use;
export const useMachines = machines.use;
export const getMachines = machines.get;
export const subscribeMachines = machines.subscribe;

export function useAgent(id: string | undefined) {
  return useAgents().find((agent) => agent.id === id);
}

export function useMachine(id: string | undefined) {
  return useMachines().find((machine) => machine.id === id);
}

export function getAgent(id: string) {
  return joined.get().find((agent) => agent.id === id);
}

export function updateCharacter(id: string, character: Look) {
  updateAgent(id, { character });
}

export function updateAgent(id: string, patch: Partial<AgentRecord>) {
  agents.set((all) => all.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
}

export function updateMachine(id: string, patch: Partial<Machine>) {
  machines.set((all) => all.map((machine) => (machine.id === id ? { ...machine, ...patch } : machine)));
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

// Pairing from the code on the Machine's screen (ADR 0006, 0035).
export function addMachine(name: string, os: Machine["os"]) {
  const machine: Machine = { id: nextId("machine"), name, os, online: true, version: "0.1.4", features: FEATURES, diskFreeGb: 256, providers: [], egress: ["github.com"] };
  machines.set((all) => [...all, machine]);
  return machine;
}

export function removeMachine(id: string) {
  agents.set((all) => all.filter((agent) => agent.machineId !== id));
  machines.set((all) => all.filter((machine) => machine.id !== id));
}

export function addProvider(machineId: string, provider: Omit<Provider, "id">) {
  const added = { ...provider, id: nextId("provider") };
  machines.set((all) => all.map((machine) => (machine.id === machineId ? { ...machine, providers: [...machine.providers, added] } : machine)));
  return added;
}

export function removeProvider(machineId: string, providerId: string) {
  machines.set((all) => all.map((machine) => (machine.id === machineId ? { ...machine, providers: machine.providers.filter((provider) => provider.id !== providerId) } : machine)));
}

// The read-only set the create screen ticks by default (ADR 0030).
export const READ_ONLY_COMMANDS = READ_ONLY;

export function createAgent(input: Pick<AgentRecord, "name" | "description" | "instructions" | "machineId" | "character" | "providerId" | "model" | "allowlist">) {
  const agent: AgentRecord = { ...input, id: nextId("agent"), budget: 10_000_000, usedToday: 0, backgroundPercent: 30, approvalMinutes: 60, memory: "", usageByMember: {}, usageBySource: {}, searchOtherTasks: true };
  agents.set((all) => [...all, agent]);
  return agent;
}

export function deleteAgent(id: string) {
  agents.set((all) => all.filter((agent) => agent.id !== id));
}

// Counts every token the Provider reports, against the Agent's Budget and for the Member the work ran for (ADR 0043).
export function charge(id: string, member: string, source: UsageSource, tokens: number) {
  agents.set((all) =>
    all.map((agent) =>
      agent.id === id
        ? {
            ...agent,
            usedToday: agent.usedToday + tokens,
            usageByMember: { ...agent.usageByMember, [member]: (agent.usageByMember[member] ?? 0) + tokens },
            usageBySource: { ...agent.usageBySource, [source]: (agent.usageBySource[source] ?? 0) + tokens },
          }
        : agent,
    ),
  );
}

// The day turns at 04:00 Machine time; here a Demo control turns it. Today's total and its split by source start over together.
export function newDay() {
  agents.set((all) => all.map((agent) => ({ ...agent, usedToday: 0, usageBySource: {} })));
}
