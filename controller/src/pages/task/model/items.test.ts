import { expect, test } from "bun:test";
import { items, summaryOf } from "./items";

const row = (seq: number, kind: string, body: unknown) => ({ seq, kind, body: JSON.stringify(body) });
const use = (id: string, command: string) => ({ type: "tool_use", id, name: "bash", input: { command } });

test("the Owner's words, the Agent's text without its thinking, and a failed Turn's code", () => {
  const result = items([
    row(1, "member.message", { text: "deploy" }),
    row(2, "turn.started", {}),
    row(3, "llm.message", {
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "on it" },
      ],
    }),
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

test("a Provider out of quota says when to try again, when it said", () => {
  const ended = (body: unknown) => ({ ...row(2, "turn.ended", body), at: 1_000 });
  expect(items([ended({ reason: "error", code: "provider.rate_limited", retryAfter: 30 })]).items.find((i) => i.kind === "error")).toMatchObject({ kind: "error", code: "provider.rate_limited", retryAt: 31_000 });
  expect(items([ended({ reason: "error", code: "provider.rate_limited" })]).items.find((i) => i.kind === "error")).not.toHaveProperty("retryAt");
});

test("a Turn that has started and not ended shows the Agent working", () => {
  expect(items([row(1, "member.message", { text: "x" }), row(2, "turn.started", {})]).working).toBe(true);
  expect(items([row(1, "turn.started", {}), row(2, "turn.ended", { reason: "done" })]).working).toBe(false);
});

test("a command shows after the Agent's words before it, running until its result comes by its id", () => {
  const events = [row(1, "turn.started", {}), row(2, "llm.message", { content: [{ type: "text", text: "looking" }, use("u1", "ls")] })];
  expect(items(events).items.at(-1)).toEqual({ key: "2-tools", kind: "tools", calls: [{ id: "u1", tool: "bash", target: "ls", state: "running" }] });
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
  expect(shown[0]).toMatchObject({
    kind: "tools",
    calls: [
      { target: "pwd", state: "ok" },
      { target: "ls /nope", state: "failed", output: "No such file\nexit code: 1" },
      { target: "echo hi", state: "ok" },
    ],
  });
});

test("a command the Turn ended before it answered is unfinished, and a tool without a command shows its name", () => {
  const { items: shown } = items([
    row(1, "turn.started", {}),
    row(2, "llm.message", { content: [use("u1", "sleep 1000"), { type: "tool_use", id: "u2", name: "read", input: { path: "a" } }] }),
    row(3, "turn.ended", { reason: "error", code: "agent.unavailable" }),
  ]);
  expect(shown[0]).toMatchObject({
    kind: "tools",
    calls: [
      { target: "sleep 1000", state: "unfinished" },
      { tool: "read", state: "unfinished" },
    ],
  });
  expect(shown[1]).toMatchObject({ kind: "error" });
});

test("an Approval shows waiting, then answered, in the log's order", () => {
  const events = [
    row(1, "turn.started", {}),
    row(2, "approval.requested", { request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 2000 }),
    row(3, "approval.answered", { request: "ap_1", member: "m_kai", decision: "deny" }),
  ];
  const { items: shown } = items(events, 1000);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toEqual({
    key: "2",
    kind: "approval",
    approval: { request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 2000, status: "denied", answeredBy: { member: "m_kai", decision: "deny" } },
  });
});

test("an Approval nobody answers shows waiting, then expired past its time", () => {
  const events = [row(1, "approval.requested", { request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 2000 })];
  expect(items(events, 1000).items[0]).toMatchObject({ kind: "approval", approval: { status: "open" } });
  expect(items(events, 3000).items[0]).toMatchObject({ kind: "approval", approval: { status: "expired" } });
});

test("a domain Approval shows the domain instead of a command (issue #44)", () => {
  const { items: shown } = items(
    [
      row(1, "turn.started", {}),
      row(2, "approval.requested", { request: "apd_1", kind: "domain", domain: "example.com", agent: "a1", task: "t1", expiresAt: 2000 }),
      row(3, "approval.answered", { request: "apd_1", member: "m_kai", decision: "always" }),
    ],
    1000,
  );
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({
    kind: "approval",
    approval: { request: "apd_1", kind: "domain", domain: "example.com", command: "example.com", parts: [], status: "approved", answeredBy: { member: "m_kai", decision: "always" } },
  });
});

test("the Machine's own expiry counts as expired, not as a denial by someone", () => {
  const { items: shown } = items(
    [row(1, "approval.requested", { request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 2000 }), row(2, "approval.answered", { request: "ap_1", decision: "deny", message: "expired without an answer" })],
    1000,
  );
  expect(shown[0]).toMatchObject({ kind: "approval", approval: { status: "expired" } });
  expect((shown[0] as { approval: { answeredBy?: unknown } }).approval.answeredBy).toBeUndefined();
});

test("a Turn that ends before anyone answers closes the Approval", () => {
  const { items: shown } = items([row(1, "turn.started", {}), row(2, "approval.requested", { request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 60_000 }), row(3, "turn.ended", { reason: "done" })]);
  expect(shown[0]).toMatchObject({ kind: "approval", approval: { status: "closed" } });
});

test("an approve with a reason keeps both, and a bad Approval row draws nothing", () => {
  const { items: shown } = items(
    [
      row(1, "approval.requested", { request: "ap_1", command: "ls && rm -rf dist", parts: ["ls", "rm -rf dist"], expiresAt: 2000, reason: "clean the build folder" }),
      row(2, "approval.answered", { request: "ap_1", member: "m_kai", decision: "approve" }),
      row(3, "approval.requested", { command: "ls" }),
    ],
    1000,
  );
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ kind: "approval", approval: { parts: ["ls", "rm -rf dist"], reason: "clean the build folder", status: "approved" } });
});

test("a Stop shows who braked, and the Turn it ended is the last thing in the log", () => {
  const { items: shown, working } = items([row(1, "turn.started", {}), row(2, "llm.message", { content: [{ type: "text", text: "starting" }] }), row(3, "turn.stopped", { member: "m_kai" }), row(4, "turn.ended", { reason: "stopped" })]);
  expect(working).toBe(false);
  expect(shown.map((i) => i.kind)).toEqual(["agent", "stopped"]);
  expect(shown.at(-1)).toMatchObject({ kind: "stopped", member: "m_kai" });
});

test("a restart that cut a Turn off shows the card that carries it on", () => {
  const { items: shown, working } = items([
    row(1, "turn.started", {}),
    row(2, "llm.message", { content: [{ type: "text", text: "deploying" }] }),
    row(3, "turn.interrupted", { reason: "restart" }),
    row(4, "turn.ended", { reason: "interrupted" }),
  ]);
  expect(working).toBe(false);
  expect(shown.map((i) => i.kind)).toEqual(["agent", "interrupted"]);
});

const call = (tool: string, input: unknown, id = tool) => ({ type: "tool_use", id, name: tool, input });
const result = (id: string, content: string, is_error = false) => ({ type: "tool_result", tool_use_id: id, content, is_error });

test("every tool names what it worked on, and a tool this build does not know shows by its name", () => {
  const events = [
    row(1, "turn.started", {}),
    row(2, "llm.message", {
      content: [
        call("read", { path: "src/a.rs" }, "r"),
        call("glob", { pattern: "**/*.rs" }, "g"),
        call("grep", { pattern: "timeout" }, "s"),
        call("edit", { path: "src/a.rs", old_string: "a", new_string: "b" }, "e"),
        call("write", { path: "b.md", content: "x" }, "w"),
        call("send_file", { path: "out.pdf" }, "f"),
        call("memory", { text: "note\nmore" }, "m"),
        call("web_fetch", { url: "x" }, "x"),
      ],
    }),
  ];
  const calls = (items(events).items[0] as { calls: { tool: string; target: string }[] }).calls;
  expect(calls.map((c) => [c.tool, c.target])).toEqual([
    ["read", "src/a.rs"],
    ["glob", "**/*.rs"],
    ["grep", "timeout"],
    ["edit", "src/a.rs"],
    ["write", "b.md"],
    ["send_file", "out.pdf"],
    ["memory", "note"],
    ["web_fetch", ""],
  ]);
});

test("a folded group names the running call, else the latest failed with its last error line, else the last", () => {
  const c = (id: string, state: "running" | "ok" | "failed", output?: string) => ({ id, tool: "bash", target: id, state, ...(output ? { output } : {}) });
  expect(summaryOf([c("a", "ok"), c("b", "running"), c("c", "failed", "x")])).toEqual({ call: c("b", "running"), hidden: 2, hiddenFailed: true });
  expect(summaryOf([c("a", "failed", "first\nlast line\n"), c("b", "ok")])).toEqual({ call: c("a", "failed", "first\nlast line\n"), error: "last line", hidden: 1, hiddenFailed: false });
  expect(summaryOf([c("a", "ok"), c("b", "ok")])).toEqual({ call: c("b", "ok"), hidden: 1, hiddenFailed: false });
});

test("a Turn that ended lists the files edit and write changed, once each, and none when it only read or failed", () => {
  const turn = (calls: unknown[], results: unknown[]) => [row(1, "turn.started", {}), row(2, "llm.message", { content: calls }), row(3, "tool.result", { content: results }), row(4, "turn.ended", { reason: "done" })];
  const changed = items(turn([call("edit", { path: "a.rs" }, "1"), call("edit", { path: "a.rs" }, "2"), call("write", { path: "b.md" }, "3")], [result("1", "ok"), result("2", "ok"), result("3", "ok")])).items;
  expect(changed.at(-1)).toMatchObject({ kind: "changes", files: ["a.rs", "b.md"] });
  const read = items(turn([call("read", { path: "a.rs" }, "1")], [result("1", "x")])).items;
  expect(read.some((i) => i.kind === "changes")).toBe(false);
  const failed = items(turn([call("edit", { path: "c.rs" }, "1")], [result("1", "no match", true)])).items;
  expect(failed.some((i) => i.kind === "changes")).toBe(false);
});

test("a time line opens the log and marks each gap of more than an hour", () => {
  const at = (seq: number, minutes: number, text: string) => ({ ...row(seq, "member.message", { text }), at: minutes * 60_000 });
  const kinds = items([at(1, 0, "a"), at(2, 30, "b"), at(3, 120, "c")]).items.map((item) => item.kind);
  expect(kinds).toEqual(["time", "member", "member", "time", "member"]);
});

test("what a round nobody watched did not do is shown, a command with its parts and a domain alone (ADR 0079)", () => {
  const log = items([row(1, "approval.skipped", { command: "rm -rf build && make", parts: ["rm -rf build", "make"] }), row(2, "approval.skipped", { domain: "example.com" })]).items;
  expect(log).toEqual([
    { key: "1", kind: "skipped", target: "rm -rf build && make", parts: ["rm -rf build", "make"], domain: false },
    { key: "2", kind: "skipped", target: "example.com", parts: [], domain: true },
  ]);
});
