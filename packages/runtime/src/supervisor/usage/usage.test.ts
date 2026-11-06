import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import { createAgentRegistry } from "../agent-registry/registry";
import { createUsageStore } from "./store";
import { createUsageSlice } from "./usage";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

const agent = (id: string): Agent => ({ id, name: id, provider: "main", model: "model-a" });

function setup(now = new Date("2026-11-06T12:00:00").getTime()) {
  const home = mkdtempSync(join(tmpdir(), "veeloe-usage-slice-"));
  const registry = createAgentRegistry(home);
  registry.add(agent("a1"));
  registry.add(agent("a2"));
  const store = createUsageStore({ home });
  store.add("a1", "2026-11-06", "task", "t1", 100);
  store.add("a1", "2026-11-06", "task", "t2", 50);
  store.add("a1", "2026-11-05", "task", "t1", 25);
  store.add("a2", "2026-11-06", "task", "", 10);
  const sent: { member: string; type: string; body: unknown }[] = [];
  const slice = createUsageSlice({
    registry,
    store,
    outbox: { toMember: (member, type, body) => void sent.push({ member, type, body }), error: (to, code) => void sent.push({ member: to.member, type: "error", body: { code } }) },
    members: () => ["m_1"],
    clock: { now: () => now },
  });
  cleanup.push(() => {
    try {
      store.close();
    } catch {}
    rmSync(home, { recursive: true, force: true });
  });
  return { registry, store, sent, slice, errors: () => sent.filter((s) => s.type === "error").map((s) => (s.body as { code: string }).code) };
}

const from = { member: "m_1", ref: "sig-1" };

test("a request gets the Machine's own range, its request id, and only the days that have rows", () => {
  const s = setup();
  s.slice(from, { request: "req-1", days: 7 });
  expect(s.sent).toHaveLength(1);
  expect(s.sent[0]).toEqual({
    member: "m_1",
    type: "usage.listed",
    body: {
      request: "req-1",
      from: "2026-10-31",
      to: "2026-11-06",
      agents: [
        { agent: "a1", days: [{ day: "2026-11-05", tokens: 25 }, { day: "2026-11-06", tokens: 150 }], tasks: [{ task: "t1", tokens: 125 }, { task: "t2", tokens: 50 }], sources: [{ source: "task", tokens: 175 }] },
        { agent: "a2", days: [{ day: "2026-11-06", tokens: 10 }], tasks: [], sources: [{ source: "task", tokens: 10 }] },
      ],
    },
  });
});

test("the range follows the Machine's 04:00 day, not the asker's clock", () => {
  const s = setup(new Date("2026-11-06T03:00:00").getTime());
  s.slice(from, { request: "req-1", days: 1 });
  expect(s.sent[0]!.body).toMatchObject({ from: "2026-11-05", to: "2026-11-05" });
});

test("one Agent at a time, and a Member without Manage is not told it exists", () => {
  const s = setup();
  s.slice(from, { request: "req-1", days: 7, agent: "a2" });
  expect((s.sent[0]!.body as { agents: { agent: string }[] }).agents.map((a) => a.agent)).toEqual(["a2"]);
  s.sent.length = 0;
  s.slice({ member: "m_2", ref: "sig-2" }, { request: "req-2", days: 7, agent: "a1" });
  expect(s.errors()).toEqual(["agent.unknown"]);
  expect(s.sent.filter((m) => m.type === "usage.listed")).toEqual([]);
});

test("a number of days outside 1 to 90 is refused, and no answer goes out", () => {
  const s = setup();
  for (const days of [0, 91, -1, 1.5]) s.slice(from, { request: "req", days });
  expect(s.errors()).toEqual(["usage.invalid_range", "usage.invalid_range", "usage.invalid_range", "usage.invalid_range"]);
  expect(s.sent.filter((m) => m.type === "usage.listed")).toEqual([]);
});

test("the asker hears back alone, even with several Agents in the answer", () => {
  const s = setup();
  s.slice(from, { request: "req-1", days: 7 });
  expect(s.sent.every((m) => m.member === "m_1")).toBe(true);
});
