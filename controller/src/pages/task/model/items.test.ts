import { expect, test } from "bun:test";
import { items } from "./items";

const row = (seq: number, kind: string, body: unknown) => ({ seq, kind, body: JSON.stringify(body) });

test("the Owner's words, the Agent's text without its thinking, and a failed Turn's code", () => {
  const result = items([
    row(1, "member.message", { text: "deploy" }),
    row(2, "turn.started", {}),
    row(3, "llm.message", { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "on it" }, { type: "tool_use", id: "x" }] }),
    row(4, "tool.result", { content: [] }),
    row(5, "turn.ended", { reason: "error", code: "provider.unreachable" }),
    row(6, "future.kind", {}),
  ]);
  expect(result).toEqual({
    working: false,
    items: [
      { key: "1", kind: "member", text: "deploy" },
      { key: "3", kind: "agent", text: "on it" },
      { key: "5", kind: "error", code: "provider.unreachable" },
    ],
  });
});

test("a Turn that has started and not ended shows the Agent working", () => {
  expect(items([row(1, "member.message", { text: "x" }), row(2, "turn.started", {})]).working).toBe(true);
  expect(items([row(1, "turn.started", {}), row(2, "turn.ended", { reason: "done" })]).working).toBe(false);
});
