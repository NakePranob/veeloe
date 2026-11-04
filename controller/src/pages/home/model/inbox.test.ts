import { expect, test } from "bun:test";
import { inboxRows } from "./inbox";

const agent = (id: string, machine_id = "m1") => ({ id, machine_id });
const task = (id: string, agent_id: string, updated_at: number, working = 0, events = 4) => ({ id, agent_id, updated_at, working, events });

test("one row per Agent with its latest Task: working first, then newest, then not started, then offline", () => {
  const rows = inboxRows(
    [agent("quiet"), agent("busy"), agent("old"), agent("away", "m2")],
    [task("t1", "old", 10), task("t2", "old", 30), task("t3", "busy", 5, 1), task("t4", "away", 50)],
    (machine) => machine !== "m2",
  );
  expect(rows.map((r): (string | undefined)[] => [r.agent.id, r.task?.id, r.status])).toEqual([
    ["busy", "t3", "working"],
    ["old", "t2", "done"],
    ["quiet", undefined, "new"],
    ["away", "t4", "offline"],
  ]);
});

test("a Machine nobody has heard from yet is not called offline", () => {
  expect(inboxRows([agent("a")], [], () => null)[0]!.status).toBe("new");
});
