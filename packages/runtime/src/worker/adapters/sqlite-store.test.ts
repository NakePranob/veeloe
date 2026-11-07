import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEventStore } from "./sqlite-store";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-tasks-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "tasks.db");
}

test("events number from 1 without a gap per Task, survive reopening, and a message id is kept once", () => {
  const file = tempDb();
  const store = openEventStore(file, { now: () => 42 });
  store.createTask("a", "m_1");
  store.createTask("b", "m_1");
  store.append("a", "member.message", { text: "x" }, "msg-1");
  store.append("b", "turn.started", {});
  store.append("a", "turn.started", {});
  expect(() => store.append("a", "member.message", {}, "msg-1")).toThrow();
  store.close();

  const again = openEventStore(file);
  expect(again.events("a").map((e) => [e.seq, e.kind])).toEqual([
    [1, "member.message"],
    [2, "turn.started"],
  ]);
  expect(again.events("a", 1).map((e) => e.seq)).toEqual([2]);
  expect(again.events("b")[0]).toEqual({ seq: 1, kind: "turn.started", at: 42, body: {} });
  expect(again.hasMessage("msg-1")).toBe(true);
  expect(again.starterOf("a")).toBe("m_1");
  expect(again.starterOf("nope")).toBeUndefined();
  again.close();
});

test("a Member's list of Tasks has the ones they started and none of another Member's (ADR 0060)", () => {
  let now = 10;
  const store = openEventStore(tempDb(), { now: () => now++ });
  store.createTask("mine", "m_1");
  store.createTask("theirs", "m_2");
  store.createTask("quiet", "m_1");
  store.append("mine", "member.message", {});
  store.append("theirs", "member.message", {});
  expect(store.tasksStartedBy("m_1").sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: "mine", updated: 13 },
    { id: "quiet", updated: 12 },
  ]);
  store.close();
});


test("openTurns names exactly the Tasks whose last Turn boundary is a start", () => {
  const store = openEventStore(tempDb());
  store.createTask("running", "m_1");
  store.append("running", "turn.started", {});
  store.createTask("ended", "m_1");
  store.append("ended", "turn.started", {});
  store.append("ended", "turn.ended", { reason: "done" });
  store.createTask("untouched", "m_1");
  store.append("untouched", "member.message", { text: "hi" }, "msg-2");
  store.createTask("stopped", "m_1");
  store.append("stopped", "turn.started", {});
  store.append("stopped", "turn.stopped", { member: "m_1" });
  store.append("stopped", "turn.ended", { reason: "stopped" });
  expect(store.openTurns().sort()).toEqual(["running"]);
  store.close();
});

test("openTurns still sees a Turn a worker died in the middle of, after its later events", () => {
  const store = openEventStore(tempDb());
  // The shapes a worker leaves when it ends after each middle event of a Turn.
  for (const [task, middle] of [
    ["after-llm", "llm.message"],
    ["after-tool", "tool.result"],
    ["after-approval", "approval.requested"],
  ] as const) {
    store.createTask(task, "m_1");
    store.append(task, "turn.started", {});
    store.append(task, middle, {});
  }
  expect(store.openTurns().sort()).toEqual(["after-approval", "after-llm", "after-tool"]);
  store.close();
});
