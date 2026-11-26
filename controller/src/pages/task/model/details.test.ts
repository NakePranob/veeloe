import { expect, test } from "bun:test";
import { contextPartsOf, factsOf } from "./details";

const row = (seq: number, kind: string, body: unknown, at = 1000 + seq) => ({ seq, kind, body: JSON.stringify(body), at });

test("the newest context.usage is split part by part, in the sheet's order, without empty parts", () => {
  const events = [
    row(1, "context.usage", { tokens: 10, window: 1000, threshold: 700, parts: { you: 5 } }),
    row(2, "context.usage", { tokens: 40, window: 1000, threshold: 700, parts: { results: 300, system: 50, you: 0, agent: 20, mystery: 9 } }),
  ];
  expect(contextPartsOf(events)).toEqual({
    window: 1000,
    used: 370,
    parts: [
      { part: "system", tokens: 50 },
      { part: "agent", tokens: 20 },
      { part: "results", tokens: 300 },
    ],
  });
});

test("a Runtime that writes no parts gives the sheet no context to split", () => {
  expect(contextPartsOf([row(1, "context.usage", { tokens: 10, window: 1000, threshold: 700 })])).toBeNull();
  expect(contextPartsOf([])).toBeNull();
});

test("facts count Turns, leave a new name out of the times, and list each changed file once", () => {
  const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
  const events = [
    row(1, "member.message", { id: "m1", text: "fix it" }, 100),
    row(2, "turn.started", {}, 110),
    row(3, "llm.message", { content: [use("t1", "edit", { path: "a.rs" }), use("t2", "edit", { path: "a.rs" })] }, 120),
    row(
      4,
      "tool.result",
      {
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "ok" },
          { type: "tool_result", tool_use_id: "t2", content: "ok" },
        ],
      },
      130,
    ),
    row(5, "llm.message", { content: [{ type: "text", text: "done" }] }, 140),
    row(6, "turn.ended", { reason: "done" }, 150),
    row(7, "task.titled", { title: "Fix" }, 999),
  ];
  const facts = factsOf(events);
  expect(facts.turns).toBe(1);
  expect(facts.started).toBe(100);
  expect(facts.last).toBe(150);
  expect(facts.changed).toEqual(["a.rs"]);
});
