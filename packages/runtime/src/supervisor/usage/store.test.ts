import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shiftDay } from "./day";
import { createUsageStore, UsageError } from "./store";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup() {
  const home = mkdtempSync(join(tmpdir(), "veeloe-usage-"));
  const store = createUsageStore({ home });
  cleanup.push(() => {
    try {
      store.close();
    } catch {
      // already closed by a test that reopened it
    }
    rmSync(home, { recursive: true, force: true });
  });
  const legacy = join(home, "runtime/usage.json");
  return { home, store, legacy };
}

test("answers add into one row per Agent, day, source and Task, and never lose a byte of a later one", () => {
  const s = setup();
  s.store.add("a1", "2026-11-06", "task", "t1", 1_000);
  s.store.add("a1", "2026-11-06", "task", "t1", 500);
  s.store.add("a1", "2026-11-06", "task", "t2", 200);
  s.store.add("a1", "2026-11-06", "task", "", 50);
  s.store.add("a2", "2026-11-06", "task", "t1", 10);

  expect(s.store.total("a1", "2026-11-06")).toBe(1_750);
  expect(s.store.total("a2", "2026-11-06")).toBe(10);
  expect(s.store.total("a1", "2026-11-05")).toBe(0);

  expect(s.store.range({ agents: ["a1", "a2"], from: "2026-11-06", to: "2026-11-06" })).toEqual([
    { agent: "a1", days: [{ day: "2026-11-06", tokens: 1_750 }], tasks: [{ task: "t1", tokens: 1_500 }, { task: "t2", tokens: 200 }], sources: [{ source: "task", tokens: 1_750 }] },
    { agent: "a2", days: [{ day: "2026-11-06", tokens: 10 }], tasks: [{ task: "t1", tokens: 10 }], sources: [{ source: "task", tokens: 10 }] },
  ]);
});

test("a range keeps only the days it has, the biggest Tasks first, and leaves an Agent with nothing out", () => {
  const s = setup();
  s.store.add("a1", "2026-11-04", "task", "old", 10);
  s.store.add("a1", "2026-11-06", "task", "new", 30);
  s.store.add("a1", "2026-11-06", "task", "middle", 20);
  for (let i = 0; i < 25; i++) s.store.add("a1", "2026-11-06", "task", `small-${i}`, 1);

  const [agent] = s.store.range({ agents: ["a1", "a2"], from: "2026-11-05", to: "2026-11-06" });
  expect(agent!.days).toEqual([{ day: "2026-11-06", tokens: 75 }]);
  expect(agent!.tasks).toHaveLength(20);
  expect(agent!.tasks[0]).toEqual({ task: "new", tokens: 30 });
  expect(s.store.range({ agents: ["a2"], from: "2026-11-05", to: "2026-11-06" })).toEqual([]);
});

test("a day older than 30 days leaves when a new Budget day arrives, and the tally survives a restart", () => {
  const s = setup();
  s.store.add("a1", "2026-10-01", "task", "t1", 100);
  s.store.add("a1", "2026-11-06", "task", "t2", 200);
  expect(s.store.total("a1", "2026-10-01")).toBe(0);
  expect(s.store.total("a1", "2026-11-06")).toBe(200);

  // The last 29 days stay; the 30th before today is the oldest that counts.
  s.store.add("a1", "2026-10-08", "task", "kept", 5);
  expect(s.store.total("a1", "2026-10-08")).toBe(5);
  s.store.add("a1", "2026-11-07", "task", "next", 1);
  expect(s.store.total("a1", "2026-10-08")).toBe(0);

  s.store.close();
  const again = createUsageStore({ home: s.home });
  cleanup.push(() => again.close());
  expect(again.total("a1", "2026-11-06")).toBe(200);
});

test("the file is owner-only, and the day shift counts calendar days", () => {
  const s = setup();
  expect(statSync(join(s.home, "runtime/usage.db")).mode & 0o777).toBe(0o600);
  expect(shiftDay("2026-11-06", -29)).toBe("2026-10-08");
  expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
});

test("the old usage.json comes in once as an unnamed Task, and is renamed so it is never read twice", () => {
  const s = setup();
  mkdirSync(join(s.home, "runtime"), { recursive: true });
  writeFileSync(s.legacy, JSON.stringify({ a1: { day: "2026-11-06", tokens: 2_000 }, a2: { day: "2026-11-05", tokens: 100 } }));
  s.store.importLegacy();
  expect(s.store.total("a1", "2026-11-06")).toBe(2_000);
  expect(s.store.total("a2", "2026-11-05")).toBe(100);
  expect(existsSync(s.legacy)).toBe(false);
  expect(existsSync(`${s.legacy}.migrated`)).toBe(true);
  expect(s.store.range({ agents: ["a1"], from: "2026-11-06", to: "2026-11-06" })[0]!.tasks).toEqual([]);

  // A second run has no file to read and changes nothing.
  s.store.importLegacy();
  expect(s.store.total("a1", "2026-11-06")).toBe(2_000);
});

test("a broken usage.json stops the import instead of losing the tally without a word", () => {
  const s = setup();
  mkdirSync(join(s.home, "runtime"), { recursive: true });
  writeFileSync(s.legacy, "{ this is not json");
  expect(() => s.store.importLegacy()).toThrow(UsageError);
});

test("a usage.json of the wrong shape stops the import and is not renamed away", () => {
  const s = setup();
  mkdirSync(join(s.home, "runtime"), { recursive: true });
  writeFileSync(s.legacy, JSON.stringify([{ agent: "a1", tokens: 10 }]));
  expect(() => s.store.importLegacy()).toThrow(UsageError);
  expect(existsSync(s.legacy)).toBe(true);
});
