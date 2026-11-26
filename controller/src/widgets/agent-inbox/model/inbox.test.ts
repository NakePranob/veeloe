import { expect, mock, test } from "bun:test";
import * as tasks from "../../../entities/task/model/tasks";

// The entity's public API also brings its React hooks and expo-sqlite, which Bun cannot load.
// A plain factory: an async one for the same module as links.test hangs Bun when both run in one process.
mock.module("../../../entities/task", () => tasks);
const { countsOf, inboxRows, rowsOf, tabOf } = await import("./inbox");

const agent = (id: string, machine_id = "m1") => ({ id, machine_id });
const ended = (reason: "done" | "error" | "quiet") => ({ latest_kind: "turn.ended", latest_body: JSON.stringify({ reason }) });
const running = { latest_kind: "turn.started", latest_body: "{}" };
const task = (id: string, agent_id: string, updated_at: number, latest: { latest_kind: string | null; latest_body: string | null } = ended("done")) => ({ id, agent_id, updated_at, ...latest });

test("one row per Agent with its latest Task: working first, then failed and done by time, then not started, then offline", () => {
  const rows = inboxRows(
    [agent("quiet"), agent("busy"), agent("old"), agent("broken"), agent("away", "m2")],
    [task("t1", "old", 10), task("t2", "old", 30), task("t3", "busy", 5, running), task("t5", "broken", 40, ended("error")), task("t4", "away", 50)],
    (machine) => machine !== "m2",
  );
  expect(rows.map((r): (string | undefined)[] => [r.agent.id, r.task?.id, r.status])).toEqual([
    ["busy", "t3", "working"],
    ["broken", "t5", "failed"],
    ["old", "t2", "done"],
    ["quiet", undefined, "new"],
    ["away", "t4", "offline"],
  ]);
});

test("a scheduled round with nothing to tell stays out of the Inbox, and the Task before it shows", () => {
  const rows = inboxRows([agent("a")], [task("t1", "a", 10), task("t2", "a", 20, ended("quiet"))], () => true);
  expect(rows[0]!.task?.id).toBe("t1");
  expect(tasks.statusOf(ended("quiet"), true)).toBe("done");
});

test("a Machine nobody has heard from yet is not called offline", () => {
  expect(inboxRows([agent("a")], [], () => null)[0]!.status).toBe("new");
});

test("an Agent waiting on its Owner, failed or interrupted needs you; not started and offline are in All only", () => {
  expect(tabOf("waiting")).toBe("needsYou");
  expect(tabOf("failed")).toBe("needsYou");
  expect(tabOf("interrupted")).toBe("needsYou");
  expect(tabOf("stuck")).toBe("needsYou");
  expect(tabOf("working")).toBe("working");
  expect(tabOf("done")).toBe("done");
  expect(tabOf("new")).toBeNull();
  expect(tabOf("offline")).toBeNull();
  const rows = [{ status: "working" as const }, { status: "waiting" as const }, { status: "offline" as const }, { status: "failed" as const }];
  expect(rowsOf(rows, "all")).toEqual(rows);
  expect(rowsOf(rows, "needsYou")).toEqual([{ status: "waiting" }, { status: "failed" }]);
  expect(countsOf(rows)).toEqual({ needsYou: 2, working: 1 });
});
