import { expect, test } from "bun:test";
import type { TaskEvent } from "../../../entities/task";
import { items } from "./items";

test("commands run back to back fold into one item; text splits them", () => {
  const events: TaskEvent[] = [
    { type: "turn_start" },
    { type: "tool_call", id: "a", command: "npm test" },
    { type: "tool_result", id: "a", ok: true, output: "ok" },
    { type: "tool_call", id: "b", command: "git status" },
    { type: "text", text: "สะอาด" },
    { type: "tool_call", id: "c", command: "npm run build" },
    { type: "turn_end" },
  ].map((body, i) => ({ ...body, seq: i + 1, at: 0 }) as TaskEvent);
  expect(items(events).map((item) => (item.kind === "tools" ? item.calls.map((call) => call.id) : item.event.type))).toEqual([["a", "b"], "text", ["c"]]);
});
