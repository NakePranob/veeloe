import type { Agent } from "@veeloe/protocol";
import type { UsageStore } from "../usage/store";

/** When an Agent's Budget day turns over (ADR 0043): 04:00 in the Machine's own time. */
const DAY_STARTS_AT = 4 * 60 * 60 * 1000;

/** The tokens an Agent gets when no one set a Budget (ADR 0043). */
export const DEFAULT_BUDGET = 10_000_000;

/** The four fields of an Anthropic `usage` that all count (ADR 0043). */
const USAGE_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"] as const;

/** A Provider's count cannot take tokens away: a negative one is zero. */
const counted = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined);

/** What a Machine keeps per Agent: only today's tally, and the day it belongs to. */
export type Tally = { day: string; tokens: number };
type Tallies = Record<string, Tally>;

/** The day a moment falls in, named the way the usage store keys a day. */
export function budgetDay(now: number): string {
  const at = new Date(now - DAY_STARTS_AT);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const date = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${date}`;
}

function total(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  let sum = 0;
  let seen = false;
  for (const field of USAGE_FIELDS) {
    const value = counted(record[field]);
    if (value !== undefined) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : undefined;
}

/** The last value each field carries in a stream, since `output_tokens` is a running total. */
function inStream(text: string): number | undefined {
  const latest = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const usage = (event as { usage?: unknown }).usage ?? (event as { message?: { usage?: unknown } }).message?.usage;
    if (!usage || typeof usage !== "object") continue;
    for (const field of USAGE_FIELDS) {
      const value = counted((usage as Record<string, unknown>)[field]);
      if (value !== undefined) latest.set(field, value);
    }
  }
  let sum = 0;
  for (const value of latest.values()) sum += value;
  return latest.size > 0 ? sum : undefined;
}

/**
 * The tokens a whole answer reports, whether it is one JSON body or an SSE
 * stream (ADR 0043). Undefined when the answer says nothing of `usage`, which
 * some gateways leave out; that answer is then not counted at all.
 */
export function usageIn(text: string): number | undefined {
  const body = text.trim();
  if (body.startsWith("{")) {
    try {
      return total((JSON.parse(body) as { usage?: unknown }).usage);
    } catch {
      return undefined;
    }
  }
  return inStream(text);
}

/**
 * Today's tokens per Agent, read from the usage store that also keeps the
 * history (ADR 0043, 0066). A tally from another day is zero: nothing resets on
 * a timer, and a Machine that was off over 04:00 starts its day when it is asked.
 */
export function createBudgets({ store, clock = { now: Date.now } }: { store: Pick<UsageStore, "add" | "total">; clock?: { now: () => number } }) {
  const today = () => budgetDay(clock.now());
  const limitOf = (agent: Agent) => agent.budget ?? DEFAULT_BUDGET;

  /** Today's tally, with another day's reading as zero. */
  function usageOf(agent: Agent): Tally {
    const day = today();
    return { day, tokens: store.total(agent.id, day) };
  }

  return {
    day: today,
    usageOf,
    limitOf,

    /** `task` is the Task the answer belonged to, or an empty string when the request said none. */
    add(agent: Agent, task: string, tokens: number) {
      const { day } = usageOf(agent);
      store.add(agent.id, day, "task", task, tokens);
      return usageOf(agent);
    },

    /** True when today's tokens have reached the Agent's Budget. */
    exhausted: (agent: Agent) => usageOf(agent).tokens >= limitOf(agent),

    /** For `agent.listed`: the Agent's Budget and today's usage. */
    listedOf: (agent: Agent) => ({ budget: limitOf(agent), usage: usageOf(agent) }),

  };
}

export type Budgets = ReturnType<typeof createBudgets>;
