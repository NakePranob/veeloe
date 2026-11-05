import { expect, test } from "bun:test";
import { items } from "./items";

const row = (seq: number, kind: string, body: unknown) => ({ seq, kind, body: JSON.stringify(body) });
const use = (id: string, command: string) => ({ type: "tool_use", id, name: "bash", input: { command } });
const result = (id: string, content: string, is_error = false) => ({ type: "tool_result", tool_use_id: id, content, ...(is_error ? { is_error } : {}) });

test("the Owner's words, the Agent's text without its thinking, and a failed Turn's code", () => {
  const result = items([
    row(1, "member.message", { text: "deploy" }),
    row(2, "turn.started", {}),
    row(3, "llm.message", { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "on it" }] }),
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

test("a command shows after the Agent's words before it, running until its result comes by its id", () => {
  const events = [row(1, "turn.started", {}), row(2, "llm.message", { content: [{ type: "text", text: "looking" }, use("u1", "ls")] })];
  expect(items(events).items.at(-1)).toEqual({ key: "2-tools", kind: "tools", calls: [{ id: "u1", command: "ls", state: "running" }] });
  const done = items([...events, row(3, "tool.result", { content: [result("u1", "a.txt\nexit code: 0")] }), row(4, "llm.message", { content: [{ type: "text", text: "one file" }] }), row(5, "turn.ended", { reason: "done" })]);
  expect(done.items.map((i) => i.kind)).toEqual(["agent", "tools", "agent"]);
  expect(done.items[1]).toMatchObject({ calls: [{ id: "u1", state: "ok", output: "a.txt\nexit code: 0" }] });
});

test("commands back to back fold into one item, each with its own result, and a failed one says so", () => {
  const { items: shown } = items([
    row(1, "turn.started", {}),
    row(2, "llm.message", { content: [use("u1", "pwd"), use("u2", "ls /nope")] }),
    row(3, "tool.result", { content: [result("u2", "No such file\nexit code: 1", true), result("u1", "/w\nexit code: 0")] }),
    row(4, "llm.message", { content: [use("u3", "echo hi")] }),
    row(5, "tool.result", { content: [result("u3", "hi\nexit code: 0")] }),
    row(6, "llm.message", { content: [{ type: "text", text: "done" }] }),
    row(7, "turn.ended", { reason: "done" }),
  ]);
  expect(shown).toHaveLength(2);
  expect(shown[0]).toMatchObject({ kind: "tools", calls: [{ command: "pwd", state: "ok" }, { command: "ls /nope", state: "failed", output: "No such file\nexit code: 1" }, { command: "echo hi", state: "ok" }] });
});

test("a command the Turn ended before it answered is unfinished, and a tool without a command shows its name", () => {
  const { items: shown } = items([
    row(1, "turn.started", {}),
    row(2, "llm.message", { content: [use("u1", "sleep 1000"), { type: "tool_use", id: "u2", name: "read", input: { path: "a" } }] }),
    row(3, "turn.ended", { reason: "error", code: "agent.unavailable" }),
  ]);
  expect(shown[0]).toMatchObject({ kind: "tools", calls: [{ command: "sleep 1000", state: "unfinished" }, { command: "read", state: "unfinished" }] });
  expect(shown[1]).toMatchObject({ kind: "error" });
});
