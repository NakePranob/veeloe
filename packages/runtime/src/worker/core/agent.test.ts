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

function setup({ replies = [] as (LlmReply | Error)[], tools = noTools, allowlist = [] as string[], approvalTimeoutMs }: { replies?: (LlmReply | Error)[]; tools?: ToolRunner; allowlist?: string[]; approvalTimeoutMs?: number } = {}) {
  const store = memoryStore();
  const sent: FromWorker[] = [];
  const requests: LlmRequest[] = [];
  const queue = [...replies];
  const gate: { wait?: Promise<void> } = {};
  const core = createAgentCore({
    name: "Deployer",
    allowlist,
    ...(approvalTimeoutMs !== undefined && { approvalTimeoutMs }),
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
  const { core, requests, gate } = setup({ replies: [{ content: [{ type: "tool_use", id: "u1", name: "echo", input: {} }], stopReason: "tool_use" }], tools: echoTool, allowlist: ["echo"] });
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
  const { core, store, requests } = setup({ tools: echoTool, allowlist: ["echo"], replies: [{ content: [use], stopReason: "tool_use" }, text("done")] });
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
  const { core, store, requests } = setup({ tools: echoTool, allowlist: ["echo"], replies: Array.from({ length: MAX_ROUNDS + 5 }, () => ({ content: [use], stopReason: "tool_use" })) });
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

function bashFake(ran: string[]): ToolRunner {
  return {
    definitions: () => [{ name: "bash", description: "bash", input_schema: { type: "object" } }],
    run: async (name, input) => {
      if (name !== "bash") throw new Error(`there is no tool named ${name}`);
      ran.push((input as { command?: string }).command ?? "");
      return "ran";
    },
  };
}

const bashUse = (command: string) => ({ type: "tool_use", id: `tu-${command}`, name: "bash", input: { command } });
const requestedOf = (store: ReturnType<typeof memoryStore>, task = "t1") => store.all.get(task)?.find((e) => e.kind === "approval.requested")?.body as { request: string } | undefined;
async function waitForRequested(store: ReturnType<typeof memoryStore>) {
  for (let i = 0; i < 200 && !requestedOf(store); i++) await Bun.sleep(5);
  return requestedOf(store)!;
}
const approvalAnswer = (request: string, decision: "approve" | "deny" | "redirect", message?: string): Extract<ToWorker, { kind: "approval" }> => ({ kind: "approval", request, decision, ...(message !== undefined && { message }), member: "m_owner", ref: `sig-${request}` });

test("a bash command in the Allowlist runs without asking", async () => {
  const ran: string[] = [];
  const { core, store } = setup({ tools: bashFake(ran), allowlist: ["ls"], replies: [{ content: [bashUse("ls -la")], stopReason: "tool_use" }, text("done")] });
  core.receive(message("go"));
  await core.idle();
  expect(ran).toEqual(["ls -la"]);
  expect(kinds(store.all.get("t1"))).not.toContain("approval.requested");
});

test("an approved command runs, and the log holds the Approval pair", async () => {
  const ran: string[] = [];
  const { core, store, requests } = setup({ tools: bashFake(ran), replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("done")] });
  core.receive(message("go"));
  const { request } = await waitForRequested(store);
  expect(ran).toEqual([]);
  core.receive(approvalAnswer(request, "approve"));
  await core.idle();
  expect(ran).toEqual(["rm -rf dist"]);
  expect(kinds(store.all.get("t1"))).toEqual(["member.message", "turn.started", "llm.message", "approval.requested", "approval.answered", "tool.result", "llm.message", "turn.ended"]);
  expect(store.all.get("t1")!.find((e) => e.kind === "approval.answered")!.body).toMatchObject({ request, member: "m_owner", decision: "approve" });
  expect(requests[1]!.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu-rm -rf dist", content: "ran" }] });
});

test("a denied command comes back as an error result, and the Turn goes on", async () => {
  const ran: string[] = [];
  const { core, store, requests } = setup({ tools: bashFake(ran), replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("sorry")] });
  core.receive(message("go"));
  const { request } = await waitForRequested(store);
  core.receive(approvalAnswer(request, "deny"));
  await core.idle();
  expect(ran).toEqual([]);
  const result = requests[1]!.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
  expect(result[0]!.is_error).toBe(true);
  expect(result[0]!.content).toContain("denied");
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "done" });
});

test("a redirect tells the LLM what to do instead", async () => {
  const ran: string[] = [];
  const { core, store, requests } = setup({ tools: bashFake(ran), replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("ok")] });
  core.receive(message("go"));
  const { request } = await waitForRequested(store);
  core.receive(approvalAnswer(request, "redirect", "use ls instead"));
  await core.idle();
  expect(ran).toEqual([]);
  const result = requests[1]!.messages.at(-1)!.content as { content: string }[];
  expect(result[0]!.content).toContain("use ls instead");
});

test("an Approval no one answers expires, and the command does not run", async () => {
  const ran: string[] = [];
  const { core, store, requests } = setup({ tools: bashFake(ran), approvalTimeoutMs: 20, replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("ok")] });
  core.receive(message("go"));
  await core.idle();
  expect(ran).toEqual([]);
  const result = requests[1]!.messages.at(-1)!.content as { content: string }[];
  expect(result[0]!.content).toContain("expired");
  expect(store.all.get("t1")!.find((e) => e.kind === "approval.answered")!.body).toMatchObject({ decision: "deny", message: "expired without an answer" });
}, 10000);

test("an answer to no waiting Approval is approval.unknown", async () => {
  const { core, sent } = setup();
  core.receive({ kind: "approval", request: "ap_nope", decision: "approve", member: "m_owner", ref: "sig-nope" });
  expect(sent).toEqual([{ kind: "error", member: "m_owner", ref: "sig-nope", code: "approval.unknown" }]);
});

test("a new Allowlist reaches the next tool call", async () => {
  const ran: string[] = [];
  const { core, store } = setup({ tools: bashFake(ran), replies: [{ content: [bashUse("ls")], stopReason: "tool_use" }, text("done")] });
  core.setAllowlist(["ls"]);
  core.receive(message("go"));
  await core.idle();
  expect(ran).toEqual(["ls"]);
  expect(kinds(store.all.get("t1"))).not.toContain("approval.requested");
});

test("a connector tool outside the Allowlist waits too, and an exact name runs it", async () => {
  const ran: string[] = [];
  const tools: ToolRunner = {
    definitions: () => [{ name: "github/create_pull_request", description: "pr", input_schema: { type: "object" } }],
    run: async (name) => (ran.push(name), "opened"),
  };
  const use = { type: "tool_use", id: "tu-pr", name: "github/create_pull_request", input: {} };
  const { core, store, requests } = setup({ tools, replies: [{ content: [use], stopReason: "tool_use" }, text("done")] });
  core.receive(message("go"));
  const { request } = await waitForRequested(store);
  expect(store.all.get("t1")!.find((e) => e.kind === "approval.requested")!.body).toMatchObject({ parts: ["github/create_pull_request"] });
  core.receive(approvalAnswer(request, "approve"));
  await core.idle();
  expect(ran).toEqual(["github/create_pull_request"]);
  expect(requests[1]!.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu-pr", content: "opened" }] });
});

test("a connector tool named in the Allowlist runs without asking, and file tools always do", async () => {
  const ran: string[] = [];
  const tools: ToolRunner = {
    definitions: () => [
      { name: "read", description: "read", input_schema: { type: "object" } },
      { name: "github/create_pull_request", description: "pr", input_schema: { type: "object" } },
    ],
    run: async (name) => (ran.push(name), "ok"),
  };
  const { core, store } = setup({
    tools,
    allowlist: ["github/create_pull_request"],
    replies: [
      { content: [{ type: "tool_use", id: "u1", name: "github/create_pull_request", input: {} }], stopReason: "tool_use" },
      { content: [{ type: "tool_use", id: "u2", name: "read", input: {} }], stopReason: "tool_use" },
      text("done"),
    ],
  });
  core.receive(message("go"));
  await core.idle();
  expect(ran).toEqual(["github/create_pull_request", "read"]);
  expect(kinds(store.all.get("t1"))).not.toContain("approval.requested");
});

test("an answer for another Task is approval.unknown", async () => {
  const { core, store, sent } = setup({ tools: bashFake([]), replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("ok")] });
  core.receive(message("go"));
  const { request } = await waitForRequested(store);
  core.receive({ kind: "approval", request, decision: "approve", member: "m_owner", ref: "sig-x", task: "other-task" });
  expect(sent.at(-1)).toEqual({ kind: "error", member: "m_owner", ref: "sig-x", code: "approval.unknown" });
  core.receive(approvalAnswer(request, "deny"));
  await core.idle();
  expect(store.all.get("t1")!.at(-1)!.body).toEqual({ reason: "done" });
});

test("a new timeout reaches the next wait, and a bad value keeps the old one", async () => {
  const ran: string[] = [];
  const { core, store, requests } = setup({ tools: bashFake(ran), approvalTimeoutMs: 60_000, replies: [{ content: [bashUse("rm -rf dist")], stopReason: "tool_use" }, text("ok")] });
  core.setApprovalTimeoutMs(Number.NaN);
  core.setApprovalTimeoutMs(30);
  core.receive(message("go"));
  await core.idle();
  expect(ran).toEqual([]);
  const result = requests[1]!.messages.at(-1)!.content as { content: string }[];
  expect(result[0]!.content).toContain("expired");
  expect(store.all.get("t1")!.find((e) => e.kind === "approval.answered")!.body).toMatchObject({ decision: "deny" });
}, 10000);
