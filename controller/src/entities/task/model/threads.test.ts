import { expect, test } from "bun:test";
import type { TaskSummary } from "./tasks";
import { originOf, threadsOf } from "./threads";

const round = (id: string, trigger: string | null, at: number, ended: "done" | "quiet", agent = "a1"): TaskSummary => ({
  id,
  agent_id: agent,
  machine_id: "m1",
  synced_seq: 3,
  updated_at: at,
  events: 3,
  latest_kind: "turn.ended",
  latest_body: JSON.stringify({ reason: ended }),
  last_kind: "member.message",
  last_body: null,
  title_body: ended === "done" ? JSON.stringify({ title: `CI on ${at}` }) : null,
  first_body: JSON.stringify({ member: "m_1", id, text: "check the CI", ...(trigger ? { trigger: { kind: "schedule", id: trigger, at } } : {}) }),
  trigger_id: trigger,
  quiet: ended === "quiet" ? 1 : 0,
});

test("rounds of one Trigger make one thread, newest first, and a Task a Member started is in none", () => {
  const threads = threadsOf([round("t1", "tr_1", 100, "done"), round("t2", "tr_1", 300, "quiet"), round("t3", null, 200, "done"), round("t4", "tr_2", 250, "done"), round("t5", "tr_1", 400, "done", "a2")], "a1", new Set(), true);
  expect(threads.map((thread) => [thread.id, thread.rounds.map((r) => r.task)])).toEqual([
    ["tr_1", ["t2", "t1"]],
    ["tr_2", ["t4"]],
  ]);
  expect(threads[0]?.text).toBe("check the CI");
});

test("a quiet round stays in its thread, marked as having nothing to say", () => {
  const [thread] = threadsOf([round("t1", "tr_1", 100, "done"), round("t2", "tr_1", 300, "quiet")], "a1", new Set(), true);
  expect(thread?.rounds.map((r) => [r.task, r.quiet, r.status])).toEqual([
    ["t2", true, "done"],
    ["t1", false, "done"],
  ]);
});

test("a thread deleted on this device is gone, and its Tasks are not touched", () => {
  expect(threadsOf([round("t1", "tr_1", 100, "done")], "a1", new Set(["tr_1"]), true)).toEqual([]);
  expect(originOf(round("t1", "tr_1", 100, "done"))).toEqual({ id: "tr_1", kind: "schedule", at: 100 });
  expect(originOf({ first_body: "not json" })).toBeNull();
});
