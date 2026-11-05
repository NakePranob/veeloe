import { expect, test } from "bun:test";
import type { TaskEvent } from "@veeloe/protocol";
import type { FromWorker, ToWorker } from "../../ipc";
import { createAgentCore, MAX_ROUNDS } from "./agent";
import { conversation } from "./conversation";
import { LlmError, type EventStore, type LlmReply, type LlmRequest, type ToolRunner } from "./ports";

function memoryStore(): EventStore & { all: Map<string, TaskEvent[]> } {
  const all = new Map<string, TaskEvent[]>();
  const starters = new Map<string, string>();
  const ids = new Set<string>();
  return {
    all,
    starterOf: (task) => starters.get(task),
    createTask: (task, starter) => void starters.set(task, starter),
    hasMessage: (id) => ids.has(id),
    append(task, kind, body, messageId) {
      if (messageId) ids.add(messageId);
      const events = all.get(task) ?? [];
      const event = { seq: events.length + 1, kind, at: 1000 + events.length, body };
      all.set(task, [...events, event]);
      return event;
    },
    events: (task, after = 0) => (all.get(task) ?? []).filter((e) => e.seq > after),
    tasksStartedBy: (member) => [...starters].filter(([, s]) => s === member).map(([id]) => ({ id, updated: all.get(id)?.at(-1)?.at ?? 0 })),
  };
}

const noTools: ToolRunner = { definitions: () => [], run: async () => "" };
const echoTool: ToolRunner = { definitions: () => [{ name: "echo", description: "echo", input_schema: { type: "object" } }], run: async (_, input) => JSON.stringify(input) };

function setup({ replies = [] as (LlmReply | Error)[], tools = noTools } = {}) {
  const store = memoryStore();
  const sent: FromWorker[] = [];
  const requests: LlmRequest[] = [];
  const queue = [...replies];
  const gate: { wait?: Promise<void> } = {};
  const core = createAgentCore({
    name: "Deployer",
    store,
    tools,
    link: { send: (m) => sent.push(m) },
    llm: {
      async send(request) {
        requests.push(structuredClone(request));
        await gate.wait;
        const next = queue.shift() ?? { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
        if (next instanceof Error) throw next;
        return next;
      },
    },
  });
  return { core, store, sent, requests, gate };
}

const message = (text: string, over: Partial<Extract<ToWorker, { kind: "message" }>> = {}): Extract<ToWorker, { kind: "message" }> => ({ kind: "message", task: "t1", id: `m-${text}`, member: "m_owner", text, ref: `sig-${text}`, ...over });
const kinds = (events: TaskEvent[] | undefined) => (events ?? []).map((e) => e.kind);
const text = (t: string) => ({ content: [{ type: "text", text: t }], stopReason: "end_turn" });

test("a message starts a Task and a Turn, and every event reaches the Member who started it", async () => {
  const { core, store, sent } = setup({ replies: [text("hi")] });
  core.receive(message("hello"));
  await core.idle();
  expect(kinds(store.all.get("t1"))).toEqual(["member.message", "turn.started", "llm.message", "turn.ended"]);
  expect(store.all.get("t1")!.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  expect(sent.every((m) => m.kind === "event" && m.starter === "m_owner")).toBe(true);
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "done" });
});

test("a second message goes on from the whole conversation", async () => {
  const { core, requests } = setup({ replies: [text("first answer"), text("second answer")] });
  core.receive(message("one"));
  await core.idle();
  core.receive(message("two"));
  await core.idle();
  expect(requests[1]!.messages).toEqual([
    { role: "user", content: [{ type: "text", text: "one" }] },
    { role: "assistant", content: [{ type: "text", text: "first answer" }] },
    { role: "user", content: [{ type: "text", text: "two" }] },
  ]);
});

test("a message sent again is not written twice and starts no Turn", async () => {
  const { core, store, requests } = setup();
  core.receive(message("hello"));
  await core.idle();
  core.receive(message("hello"));
  await core.idle();
  expect(kinds(store.all.get("t1")).filter((k) => k === "member.message")).toHaveLength(1);
  expect(requests).toHaveLength(1);
});

test("a message during a Turn is refused as busy and leaves the log alone", async () => {
  const { core, store, sent, gate } = setup();
  let open!: () => void;
  gate.wait = new Promise((resolve) => (open = resolve));
  core.receive(message("first"));
  core.receive(message("second"));
  expect(sent.at(-1)).toEqual({ kind: "error", member: "m_owner", ref: "sig-second", code: "agent.busy", task: "t1" });
  open();
  await core.idle();
  expect(store.all.get("t1")!.some((e) => (e.body as { text?: string }).text === "second")).toBe(false);
});

test("a new name reaches the next Turn, and the Turn running keeps the old one to its end", async () => {
  const { core, requests, gate } = setup({ replies: [{ content: [{ type: "tool_use", id: "u1", name: "echo", input: {} }], stopReason: "tool_use" }], tools: echoTool });
  let open!: () => void;
  gate.wait = new Promise((resolve) => (open = resolve));
  core.receive(message("first"));
  core.rename("Builder");
  open();
  await core.idle();
  core.receive(message("second", { task: "t2" }));
  await core.idle();
  expect(requests.map((r) => r.system.split(",")[0])).toEqual(["You are Deployer", "You are Deployer", "You are Builder"]);
});

test("a tool the LLM asks for runs, and its result goes into the next request", async () => {
  const use = { type: "tool_use", id: "tu1", name: "echo", input: { a: 1 } };
  const { core, store, requests } = setup({ tools: echoTool, replies: [{ content: [use], stopReason: "tool_use" }, text("done")] });
  core.receive(message("go"));
  await core.idle();
  expect(kinds(store.all.get("t1"))).toEqual(["member.message", "turn.started", "llm.message", "tool.result", "llm.message", "turn.ended"]);
  expect(requests[1]!.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: '{"a":1}' }] });
});

test("a tool the Agent does not have comes back as an error result, and the Turn goes on", async () => {
  const use = { type: "tool_use", id: "tu1", name: "bash", input: {} };
  const { core, store, requests } = setup({ replies: [{ content: [use], stopReason: "tool_use" }, text("sorry")] });
  core.receive(message("go"));
  await core.idle();
  expect(requests[1]!.messages.at(-1)!.content).toEqual([{ type: "tool_result", tool_use_id: "tu1", content: "there is no tool named bash", is_error: true }]);
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "done" });
});

test("a Turn that keeps asking for tools stops at the ceiling", async () => {
  const use = { type: "tool_use", id: "tu", name: "echo", input: {} };
  const { core, store, requests } = setup({ tools: echoTool, replies: Array.from({ length: MAX_ROUNDS + 5 }, () => ({ content: [use], stopReason: "tool_use" })) });
  core.receive(message("loop"));
  await core.idle();
  expect(requests).toHaveLength(MAX_ROUNDS);
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "error", code: "turn.too_many_rounds" });
});

test("a Provider that fails ends the Turn with its code, and the Task can go on", async () => {
  const { core, store } = setup({ replies: [new LlmError("provider.unreachable"), text("back")] });
  core.receive(message("one"));
  await core.idle();
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "error", code: "provider.unreachable" });
  core.receive(message("two"));
  await core.idle();
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "done" });
});

test("another Member cannot write in, or read, a Task someone else started", async () => {
  const { core, store, sent } = setup();
  core.receive(message("mine"));
  await core.idle();
  core.receive(message("theirs", { member: "m_other" }));
  core.receive({ kind: "sync", task: "t1", after: 0, member: "m_other", ref: "sig-sync" });
  expect(sent.slice(-2).map((m) => m.kind === "error" && m.code)).toEqual(["task.not_found", "task.not_found"]);
  expect(kinds(store.all.get("t1")).filter((k) => k === "member.message")).toHaveLength(1);
});

test("sync answers the events after a number, for the Member who started the Task", async () => {
  const { core, sent } = setup();
  core.receive(message("hello"));
  await core.idle();
  core.receive({ kind: "sync", task: "t1", after: 2, member: "m_owner", ref: "sig-sync" });
  const answer = sent.at(-1)!;
  expect(answer.kind === "events" && answer.events.map((e) => e.seq)).toEqual([3, 4]);
});

test("a Turn its worker never finished keeps the Member's words and drops its tool_use", () => {
  const events = [
    { seq: 1, kind: "member.message", at: 1, body: { text: "one" } },
    { seq: 2, kind: "turn.started", at: 2, body: {} },
    { seq: 3, kind: "llm.message", at: 3, body: { content: [{ type: "tool_use", id: "x", name: "echo", input: {} }] } },
    { seq: 4, kind: "member.message", at: 4, body: { text: "two" } },
    { seq: 5, kind: "turn.started", at: 5, body: {} },
  ];
  expect(conversation(events)).toEqual([
    { role: "user", content: [{ type: "text", text: "one" }] },
    { role: "user", content: [{ type: "text", text: "two" }] },
  ]);
});
