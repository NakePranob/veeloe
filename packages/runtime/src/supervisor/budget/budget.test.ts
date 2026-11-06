import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import { createUsageStore } from "../usage/store";
import { createBudgets, budgetDay, DEFAULT_BUDGET, usageIn } from "./budget";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

const at = (iso: string) => new Date(iso).getTime();
/** An Agent with no Budget of its own: the default applies. */
const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a" };

function setup(now = at("2026-11-06T12:00:00")) {
  const home = mkdtempSync(join(tmpdir(), "veeloe-budget-"));
  const store = createUsageStore({ home });
  cleanup.push(() => {
    try {
      store.close();
    } catch {
      // a restart test closes it first
    }
    rmSync(home, { recursive: true, force: true });
  });
  let current = now;
  const budgets = createBudgets({ store, clock: { now: () => current } });
  return { home, store, budgets, set: (t: number) => (current = t) };
}

test("a Budget day turns at 04:00 in the Machine's own time", () => {
  expect(budgetDay(at("2026-11-06T03:59:59"))).toBe("2026-11-05");
  expect(budgetDay(at("2026-11-06T04:00:00"))).toBe("2026-11-06");
});

test("tokens from before 04:00 are not counted after it, so the first request of a day starts at zero", () => {
  const s = setup(at("2026-11-06T03:59:00"));
  s.budgets.add(agent, "", 3_000_000);
  expect(s.budgets.usageOf(agent)).toEqual({ day: "2026-11-05", tokens: 3_000_000 });
  s.set(at("2026-11-06T04:00:00"));
  expect(s.budgets.usageOf(agent)).toEqual({ day: "2026-11-06", tokens: 0 });
});

test("a Machine off over a new day starts at zero, and a supervisor restarted the same day keeps the morning's tally", () => {
  const first = setup(at("2026-11-06T09:00:00"));
  first.budgets.add(agent, "", 2_000_000);
  const restarted = createUsageStore({ home: first.home });
  cleanup.push(() => restarted.close());
  const afterRestart = createBudgets({ store: restarted, clock: { now: () => at("2026-11-06T15:00:00") } });
  expect(afterRestart.usageOf(agent)).toEqual({ day: "2026-11-06", tokens: 2_000_000 });
  const nextDay = createBudgets({ store: restarted, clock: { now: () => at("2026-11-07T09:00:00") } });
  expect(nextDay.usageOf(agent)).toEqual({ day: "2026-11-07", tokens: 0 });
});

test("an Agent without a Budget gets 10M, and an exhausted one is the one whose tokens reach it", () => {
  const s = setup();
  expect(s.budgets.limitOf(agent)).toBe(DEFAULT_BUDGET);
  s.budgets.add(agent, "", DEFAULT_BUDGET - 1);
  expect(s.budgets.exhausted(agent)).toBe(false);
  s.budgets.add(agent, "", 1);
  expect(s.budgets.exhausted(agent)).toBe(true);
  // Another Agent on the same Machine is untouched.
  expect(s.budgets.exhausted({ ...agent, id: "a2" })).toBe(false);
  // A Budget the Owner set is used instead of the default.
  expect(s.budgets.limitOf({ ...agent, budget: 500 })).toBe(500);
  expect(s.budgets.exhausted({ ...agent, budget: 500 })).toBe(true);
});

test("the tally lands in the owner-only usage database and names the Task the answer belonged to", () => {
  const s = setup();
  s.budgets.add(agent, "t1", 1700);
  expect(statSync(join(s.home, "runtime/usage.db")).mode & 0o777).toBe(0o600);
  expect(s.store.range({ agents: ["a1"], from: "2026-11-06", to: "2026-11-06" })[0]!.tasks).toEqual([{ task: "t1", tokens: 1700 }]);
});

test("an SSE answer counts each field once, taking the running output total as the last one", () => {
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000,"cache_read_input_tokens":500,"output_tokens":1}}}',
    "",
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":200}}',
    "",
    'event: message_stop\ndata: {"type":"message_stop"}',
    "",
  ].join("\n");
  expect(usageIn(sse)).toBe(1700);
});

test("a JSON answer counts the four fields of its usage, and one without usage is not counted", () => {
  expect(usageIn(JSON.stringify({ usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 } }))).toBe(100);
  expect(usageIn(JSON.stringify({ content: [] }))).toBeUndefined();
  expect(usageIn("not JSON at all")).toBeUndefined();
});

test("a negative number from a Provider counts as zero, so it cannot take tokens away", () => {
  expect(usageIn(JSON.stringify({ usage: { input_tokens: -500, output_tokens: 10 } }))).toBe(10);
  expect(usageIn('data: {"type":"message_delta","usage":{"output_tokens":-4,"input_tokens":-9}}\n\n')).toBe(0);
  const s = setup();
  s.budgets.add(agent, "", usageIn(JSON.stringify({ usage: { input_tokens: -500, output_tokens: 10 } }))!);
  expect(s.budgets.usageOf(agent).tokens).toBe(10);
});
