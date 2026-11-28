import { expect, mock, test } from "bun:test";
import * as tasksModel from "../../../entities/task/model/tasks";

// The entity's public API also brings its React hooks and expo-sqlite, which Bun cannot load.
mock.module("../../../entities/task", () => tasksModel);
const { nextToAnswer } = await import("./answer");

const task = (id: string, agent_id: string, latest_kind: string, updated_at: number) => ({ id, agent_id, latest_kind, latest_body: null, updated_at });

test("the sheet moves to the Approval waiting longest that this Member can answer, and never back to the one just answered", () => {
  const open = [
    task("t-now", "a1", "approval.requested", 30),
    task("t-question", "a1", "card.shown", 5),
    task("t-use", "a-use", "approval.requested", 1),
    task("t-older", "a2", "approval.requested", 10),
    task("t-running", "a2", "llm.message", 2),
  ];
  const levelOf = (agent: string) => (agent === "a-use" ? "use" : "approve");
  expect(nextToAnswer(open, "t-now", levelOf)?.id).toBe("t-older");
  expect(nextToAnswer(open, "t-older", levelOf)?.id).toBe("t-now");
  expect(nextToAnswer([open[0]!], "t-now", levelOf)).toBeNull();
});
