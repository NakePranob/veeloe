import { expect, test } from "bun:test";
import type { Machine } from "../../../entities/agent";
import type { Task } from "../../../entities/task";
import { formatLine, logLines } from "./logs";

const machine = { id: "m", name: "m", lastError: "provider_401" } as Machine;
const task = {
  id: "task-1",
  agent: "deployer",
  events: [
    { seq: 1, at: 1000, type: "message", text: "รหัสผ่านคือ hunter2" },
    { seq: 2, at: 1100, type: "turn_start" },
    { seq: 3, at: 1200, type: "tool_call", id: "t1", command: "cat secrets/prod.env" },
    { seq: 4, at: 1500, type: "tool_result", id: "t1", ok: true, output: "DB_URL=postgres://root:pw@host" },
    { seq: 5, at: 1600, type: "text", text: "เสร็จแล้ว" },
    { seq: 6, at: 1700, type: "turn_end" },
  ],
} as Task;

// ADR 0052: a log never carries a message, a tool's output or a file name.
test("log lines carry ids and durations but none of the Task's content", () => {
  const text = logLines(machine, [task], ["deployer"]).map(formatLine).join("\n");
  for (const secret of ["hunter2", "secrets", "prod.env", "DB_URL", "เสร็จแล้ว", "cat "]) expect(text).not.toContain(secret);
  expect(text).toContain("tool=bash ms=300");
  expect(text).toContain("tokens=40000");
});

test("another Machine's Agents stay out", () => {
  expect(logLines(machine, [task], []).every((line) => !line.task)).toBe(true);
});
