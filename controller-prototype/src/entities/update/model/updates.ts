import { createStore } from "../../../shared/lib";

const DAY = 86_400_000;
export const DRAIN_LIMIT = 30 * 60_000;

// Compares "0.1.4" with "0.2.0"; negative when a is older.
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

// The release the Runtime found on GitHub Releases, with the manifest's signature (ADR 0009).
export interface LatestRelease {
  version: string;
  publishedAt: number;
  signatureValid: boolean;
}

export type Phase = "draining" | "verifying" | "swapping" | "restarting" | "done" | "failed";

// One Machine's update, step by step (ADR 0009, 0033).
export interface Run {
  machineId: string;
  from: string;
  to: string;
  phase: Phase;
  startedAt: number;
  deadline: number;
  // Turns that were still open at the deadline and ended as interrupted.
  interrupted: number;
  error?: string;
}

export interface Backup {
  id: string;
  machineId: string;
  machineName: string;
  // Which Workspace the file was made in; a restore needs the same one (ADR 0051).
  workspace: string;
  at: number;
  agents: number;
  tasks: number;
}

export const THIS_WORKSPACE = "demo";

interface State {
  latest: LatestRelease;
  // The oldest Runtime the Hub accepts (ADR 0009).
  hubMinimum: string;
  runs: Run[];
  backups: Backup[];
}

const now = Date.now();
const state = createStore<State>({
  latest: { version: "0.2.0", publishedAt: now - 2 * DAY, signatureValid: true },
  hubMinimum: "0.1.3",
  runs: [],
  backups: [{ id: "bk_other", machineId: "other", machineName: "server-ของบริษัทอื่น", workspace: "other-co", at: now - 9 * DAY, agents: 3, tasks: 41 }],
});

export const useUpdates = state.use;
export const getUpdates = state.get;

export function patchUpdates(patch: Partial<State>) {
  state.set((current) => ({ ...current, ...patch }));
}

export function startRun(run: Run) {
  state.set((current) => ({ ...current, runs: [...current.runs.filter((candidate) => candidate.machineId !== run.machineId), run] }));
}

export function patchRun(machineId: string, patch: Partial<Run>) {
  state.set((current) => ({ ...current, runs: current.runs.map((run) => (run.machineId === machineId ? { ...run, ...patch } : run)) }));
}

export function getRun(machineId: string) {
  return state.get().runs.find((run) => run.machineId === machineId);
}

let counter = 0;

export function addBackup(input: Omit<Backup, "id" | "at">) {
  const backup = { ...input, id: `bk_${++counter}`, at: Date.now() };
  state.set((current) => ({ ...current, backups: [backup, ...current.backups] }));
  return backup;
}
