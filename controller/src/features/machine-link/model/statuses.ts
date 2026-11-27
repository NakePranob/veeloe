import type { ListedTrigger, ProviderInfo } from "@veeloe/protocol-ts";

/** What this Controller knows of a Machine right now, beside what is in the database. */
export type MachineStatus = {
  /** Null until it has answered or the Hub said it is not there. */
  online: boolean | null;
  /** Whether envelopes to it go on a direct link now, not through the Hub (ADR 0090). */
  direct: boolean;
  providers: ProviderInfo[] | null;
  /** The code the last `agent.create` came back with, if it failed. */
  createError: string | null;
  /** The code the last `agent.update` came back with, if it failed. */
  updateError: string | null;
  /** The code the last `agent.delete` came back with, if it failed. */
  deleteError: string | null;
  /** The code the last `agent.restore` came back with, if it failed (`agent-trash`). */
  restoreError: string | null;
  /** The code the last `task.stop` came back with, if it failed (`stop-and-restart`). */
  stopError: string | null;
  /** The code the last `provider.add` came back with, if it failed. */
  providerError: string | null;
  /** What `machine.status` last said; null until the Machine answers. */
  version: string | null;
  features: string[] | null;
  lastError: string | null;
  diskFreeBytes: number | null;
  budgetToday: { usedTokens: number; limitTokens: number } | null;
};

export const UNKNOWN_MACHINE_STATUS: MachineStatus = {
  online: null,
  direct: false,
  providers: null,
  createError: null,
  updateError: null,
  deleteError: null,
  restoreError: null,
  stopError: null,
  providerError: null,
  version: null,
  features: null,
  lastError: null,
  diskFreeBytes: null,
  budgetToday: null,
};

/** One page's usage request for one Machine: what it asked for, and how it went. */
export type UsageStatus = {
  request: string | null;
  days: number | null;
  loading: boolean;
  /** A code from the Hub or the Machine, such as `hub.machine_offline` or `usage.invalid_range`. */
  error: string | null;
  /** The range the Machine chose, which its own clock defines; null before its first answer. */
  from: string | null;
  to: string | null;
  /** The biggest Tasks of that answer, for the page's list; only held in memory. */
  tasks: { agent: string; task: string; tokens: number }[];
  /** The answer's total for its range, so the "other" row comes from the same answer as the Tasks. */
  total: number;
};

export const UNKNOWN_USAGE: UsageStatus = { request: null, days: null, loading: false, error: null, from: null, to: null, tasks: [], total: 0 };

/** One Agent's Memory as the Machine last answered it; only held in memory (`agent-memory-page`). */
export type MemoryStatus = {
  request: string | null;
  machine: string | null;
  agent: string | null;
  loading: boolean;
  /** A code from the Hub or the Machine, such as `hub.machine_offline` or `agent.unknown`. */
  error: string | null;
  /** The last answer: the whole-file count and the text the next Turn's prompt gets. */
  memory: { exists: boolean; chars: number; text: string } | null;
  /** When that answer landed, so the page can say how fresh it is. */
  fetchedAt: number | null;
};

export const UNKNOWN_MEMORY: MemoryStatus = { request: null, machine: null, agent: null, loading: false, error: null, memory: null, fetchedAt: null };

/** The latest output of a command still running, by its tool call's id (ADR 0073). Only in memory, never saved. */
export type ToolOutput = { tail: string; bytes: number; elapsedMs: number; at: number };

export const NO_OUTPUT: ToolOutput = { tail: "", bytes: 0, elapsedMs: 0, at: 0 };

/** One Agent's Triggers as its Machine last listed them (issue #56); only in memory, asked again on every open. */
export type TriggerStatus = {
  loading: boolean;
  /** A `trigger.*` change is on its way; the next `trigger.listed` ends it. */
  sending: boolean;
  /** A code from the Hub or the Machine, such as `trigger.forbidden`. */
  error: string | null;
  triggers: ListedTrigger[] | null;
  /** What the Agent proposed for its Idle Work list, not signed yet (ADR 0056). */
  draft: string[] | null;
};

export const UNKNOWN_TRIGGERS: TriggerStatus = { loading: false, sending: false, error: null, triggers: null, draft: null };

/** One Agent's Memory belongs to one Machine, so the key carries both. */
export const memoryKey = (machine: string, agent: string) => `${machine}:${agent}`;

/**
 * Statuses by key, held in memory for the pages that subscribe. `all()` is a new
 * object on every change, so React can tell that something moved.
 */
export function createStatusStore<T extends object>(unknown: T) {
  const statuses = new Map<string, T>();
  let all: Record<string, T> = {};
  const listeners = new Set<() => void>();
  const notify = () => {
    all = Object.fromEntries(statuses);
    for (const listener of [...listeners]) listener();
  };
  return {
    get: (key: string) => statuses.get(key),
    or: (key: string) => statuses.get(key) ?? unknown,
    set(key: string, change: Partial<T>) {
      statuses.set(key, { ...(statuses.get(key) ?? unknown), ...change });
      notify();
    },
    entries: () => statuses.entries(),
    all: () => all,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    clear() {
      statuses.clear();
      notify();
    },
  };
}
