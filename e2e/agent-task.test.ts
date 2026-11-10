import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, publicKeyOf, toBase64url, type KnownMessage } from "@veeloe/protocol-ts";
import { startHubClient } from "../controller/src/shared/hub-client";
import { FAKE_KEY, fakeProvider, sse } from "./helpers/fake-provider";
import { buildRuntime } from "../scripts/runtime";

// The compiled `veeloe`, its workers and its proxy, through the real relay, with
// the Controller's own client and a stand-in Provider. TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));

const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-agent-"));
const home = join(work, "home");
/** The Rust debug binary this file drives, built by `scripts/runtime.ts`. */
let runtimeBinary: string;
const running: ReturnType<typeof Bun.spawn>[] = [];
const provider = fakeProvider();
let url: string;

beforeAll(async () => {
  const hubBinary = join(work, "testhub");
  const built = Bun.spawnSync(["go", "build", "-o", hubBinary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  // The Rust Runtime is the only one; `scripts/runtime.ts` builds it.
  runtimeBinary = buildRuntime();
  const hub = Bun.spawn([hubBinary], { stdout: "pipe", stderr: "inherit" });
  running.push(hub);
  const { value } = await (hub.stdout as ReadableStream<Uint8Array>).getReader().read();
  url = new TextDecoder().decode(value).trim();

  // What `veeloe pair` would have left, for the keys cmd/testhub knows.
  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "machine.key"), machineSeed, { mode: 0o600 });
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: url }), { mode: 0o600 });
  writeFileSync(join(home, "runtime/trust.json"), JSON.stringify({ owners: [{ member: "member-1", keys: [toBase64url(publicKeyOf(controllerSeed))] }] }), { mode: 0o600 });
  chmodSync(home, 0o700);

  // The key goes in on stdin, never in an argument. Written explicitly: a Blob
  // stdin arrives empty after a spawnSync in the same hook.
  const add = Bun.spawn([runtimeBinary, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
  add.stdin.write(FAKE_KEY);
  await add.stdin.end();
  if ((await add.exited) !== 0) throw new Error(await new Response(add.stdout).text());

  const supervisor = Bun.spawn([runtimeBinary], { env: { VEELOE_HOME: home, PATH: process.env.PATH }, stdout: "pipe", stderr: "inherit" });
  running.push(supervisor);
  const reader = supervisor.stdout.getReader();
  let out = "";
  while (!out.includes("connected to hub")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(out);
    out += new TextDecoder().decode(value);
  }
}, 180_000);

afterAll(() => {
  running.forEach((p) => p.kill());
  provider.server.stop(true);
  rmSync(work, { recursive: true, force: true });
});

/** A Controller connected through the relay, collecting what the Machine signed for it. */
function controller() {
  const inbox: (KnownMessage & { task?: string })[] = [];
  const ready = Promise.withResolvers<void>();
  const client = startHubClient({
    hubUrl: url,
    secretKey: controllerSeed,
    trustedKeys: new Set([machineKey]),
    onReady: () => ready.resolve(),
    onEnvelope: ({ signed }) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, task: signed.task });
    },
  });
  const send = (type: string, body: unknown, task?: string) => client.send({ type, to: "machine-1", member: "member-1", ...(task ? { task } : {}), body });
  const waitFor = async (match: (m: KnownMessage & { task?: string }) => boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = inbox.find(match);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`nothing matched; got ${inbox.map((m) => m.type).join(", ")}`);
  };
  return { client, ready: ready.promise, inbox, send, waitFor };
}

const turnEnded = (task: string, n: number) => (m: KnownMessage & { task?: string }) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended" && m.body.seq === n;

test("an Agent is made, answers twice in one Task with the whole conversation, and a late Controller catches up", async () => {
  const first = controller();
  await first.ready;
  first.send("agent.create", { id: "agent-e2e", name: "Deployer", provider: "main", model: "model-a" });
  const listed = await first.waitFor((m) => m.type === "agent.listed" && m.body.agents.length === 1);
  expect(listed.body).toMatchObject({ agents: [{ id: "agent-e2e", name: "Deployer", provider: "main", model: "model-a" }], providers: [{ name: "main" }] });

  first.send("task.message", { agent: "agent-e2e", id: "m1", text: "สวัสดี" }, "task-e2e");
  await first.waitFor(turnEnded("task-e2e", 4));
  first.send("task.message", { agent: "agent-e2e", id: "m2", text: "อีกข้อ" }, "task-e2e");
  await first.waitFor(turnEnded("task-e2e", 8));

  const second = provider.requests.filter((r) => r.path === "/v1/messages").at(-1)!.body as { model: string; messages: unknown[] };
  expect(second.model).toBe("model-a");
  expect(second.messages).toHaveLength(3);
  expect(JSON.stringify(provider.requests.map((r) => r.headers))).not.toContain("x-veeloe");
  first.client.stop();

  const late = controller();
  await late.ready;
  late.send("task.sync", { agent: "agent-e2e", after: 4 }, "task-e2e");
  const page = await late.waitFor((m) => m.type === "task.events");
  expect(page.type === "task.events" && page.body.events.map((e) => e.kind)).toEqual(["member.message", "turn.started", "llm.message", "turn.ended"]);
  late.client.stop();
}, 60_000);

test("after agent.update a Task keeps its model and a new one gets the new one, and an Agent whose Provider was removed answers again on another", async () => {
  const owner = controller();
  await owner.ready;
  const ends = (task: string) => owner.inbox.filter((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended");
  async function talk(task: string, text: string) {
    const before = ends(task).length;
    owner.send("task.message", { agent: "agent-set", id: `${task}-${text}`, text }, task);
    await owner.waitFor(() => ends(task).length > before);
    return ends(task).at(-1)!.body as { body: unknown };
  }
  const modelsAt = (p: typeof provider) => p.requests.filter((r) => r.path === "/v1/messages").map((r) => (r.body as { model: string }).model);

  owner.send("agent.create", { id: "agent-set", name: "Setter", provider: "main", model: "model-a" });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-set"));
  const before = modelsAt(provider).length;
  await talk("task-old", "one");
  owner.send("agent.update", { id: "agent-set", model: "model-b" });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-set" && a.model === "model-b"));
  await talk("task-old", "two");
  await talk("task-new", "three");
  expect(modelsAt(provider).slice(before)).toEqual(["model-a", "model-a", "model-b"]);

  // At the Machine: the Provider goes, and another comes.
  const other = fakeProvider();
  try {
    const remove = Bun.spawn([runtimeBinary, "provider", "remove", "main", "--yes"], { env: { VEELOE_HOME: home }, stdout: "pipe" });
    expect(await remove.exited).toBe(0);
    expect(await new Response(remove.stdout).text()).toContain("on the Agent's page in the Veeloe app");
    const add = Bun.spawn([runtimeBinary, "provider", "add", "--name", "second", "--url", other.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
    add.stdin.write(FAKE_KEY);
    await add.stdin.end();
    expect(await add.exited).toBe(0);

    expect(await talk("task-old", "four")).toMatchObject({ body: { reason: "error", code: "provider.missing" } });
    owner.send("agent.update", { id: "agent-set", provider: "second", model: "model-a" });
    await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-set" && a.provider === "second"));
    expect(await talk("task-old", "five")).toMatchObject({ body: { reason: "done" } });
    expect(modelsAt(other)).toEqual(["model-a"]);
  } finally {
    other.server.stop(true);
    // Put back the Provider the tests after this one use; removing it is this
    // test's own doing, not theirs.
    const restore = Bun.spawn([runtimeBinary, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
    restore.stdin.write(FAKE_KEY);
    await restore.stdin.end();
    await restore.exited;
    owner.client.stop();
  }
}, 90_000);

/** An SSE answer that asks for a tool the Machine lacks, so the Turn goes back to the LLM again. */
function toolUseSse() {
  const start = JSON.stringify({ type: "message_start", message: { id: "msg_b", type: "message", role: "assistant", model: "model-a", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const block = JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "no_such_tool", input: {} } });
  const delta = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } });
  const stop = JSON.stringify({ type: "content_block_stop", index: 0 });
  const end = JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } });
  return new Response([start, block, delta, stop, end, '{"type":"message_stop"}'].map((data) => `event: x\ndata: ${data}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("a Budget set from the app stops a Turn at its next request, refuses a new message, and lets both go once it is raised", async () => {
  const owner = controller();
  await owner.ready;
  owner.send("agent.create", { id: "agent-budget", name: "Budgeted", provider: "main", model: "model-a" });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-budget"));
  // The stand-in answers report four tokens each: one input and three output.
  owner.send("agent.update", { id: "agent-budget", budget: 4 });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-budget" && a.budget === 4));

  provider.reply = () => toolUseSse();
  const before = provider.requests.filter((r) => r.path === "/v1/messages").length;
  owner.send("task.message", { agent: "agent-budget", id: "b1", text: "go" }, "task-budget");
  const ended = await owner.waitFor((m) => m.type === "task.event" && m.task === "task-budget" && m.body.kind === "turn.ended");
  expect(ended.body.body).toMatchObject({ reason: "error", code: "budget.exhausted" });
  const endedSeq = (ended.body as { seq: number }).seq;
  // The second request of that Turn never reached the Provider.
  expect(provider.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(before + 1);

  // A new message at the spent Budget is refused, with the same code.
  owner.send("task.message", { agent: "agent-budget", id: "b2", text: "again" }, "task-budget");
  const refused = await owner.waitFor((m) => m.type === "error" && m.body.code === "budget.exhausted");
  expect(refused.body).toMatchObject({ code: "budget.exhausted" });

  // Raising the Budget past today's tokens lets the same Task go on.
  provider.reply = () => sse([{ type: "text", text: "hello" }]);
  owner.send("agent.update", { id: "agent-budget", budget: 20_000_000 });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-budget" && a.budget === 20_000_000));
  owner.send("task.message", { agent: "agent-budget", id: "b3", text: "back" }, "task-budget");
  const done = await owner.waitFor((m) => m.type === "task.event" && m.task === "task-budget" && m.body.kind === "turn.ended" && (m.body as { seq: number }).seq > endedSeq);
  expect(done.body.body).toEqual({ reason: "done" });
  owner.client.stop();
}, 90_000);

test("usage.list answers with the Machine's own days, the Tasks behind the tokens, and the request it came from", async () => {
  const owner = controller();
  await owner.ready;
  owner.send("agent.create", { id: "agent-usage", name: "Measured", provider: "main", model: "model-a" });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-usage"));

  provider.reply = () => sse([{ type: "text", text: "hello" }]);
  const ended = (task: string) => owner.inbox.filter((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended").length;
  for (const [task, text] of [["task-usage-1", "one"], ["task-usage-2", "two"]] as const) {
    const before = ended(task);
    owner.send("task.message", { agent: "agent-usage", id: `${task}-m`, text }, task);
    await owner.waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended");
    expect(ended(task)).toBe(before + 1);
  }

  owner.send("usage.list", { request: "usage-e2e", days: 1, agent: "agent-usage" });
  const answer = await owner.waitFor((m) => m.type === "usage.listed" && m.body.request === "usage-e2e");
  const today = (answer.body as { from: string }).from;
  expect(answer.body).toMatchObject({
    request: "usage-e2e",
    from: today,
    to: today,
    agents: [{ agent: "agent-usage", days: [{ day: today, tokens: 8 }], tasks: [{ task: "task-usage-1", tokens: 4 }, { task: "task-usage-2", tokens: 4 }], sources: [{ source: "task", tokens: 8 }] }],
  });

  owner.send("usage.list", { request: "usage-week", days: 7, agent: "agent-usage" });
  const week = await owner.waitFor((m) => m.type === "usage.listed" && m.body.request === "usage-week");
  const weekBody = week.body as { from: string; to: string };
  expect(weekBody.to).toBe(today);
  expect(weekBody.from < today).toBe(true);
  owner.client.stop();
}, 90_000);

/** The SSE a Provider streams for one message that asks for one `bash` command. */
function bashUseSse(command: string) {
  const start = JSON.stringify({ type: "message_start", message: { id: "msg_bash", type: "message", role: "assistant", model: "model-a", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const block = JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "bash", input: { command } } });
  const delta = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command }) } });
  const stop = JSON.stringify({ type: "content_block_stop", index: 0 });
  const end = JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } });
  return new Response([start, block, delta, stop, end, '{"type":"message_stop"}'].map((data) => `event: x\ndata: ${data}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("an Approval answered from the Controller runs the real command, and a denied one does not", async () => {
  const owner = controller();
  await owner.ready;
  const events = (task: string, kind: string) => owner.inbox.filter((m) => m.type === "task.event" && m.task === task && m.body.kind === kind);
  const requested = (task: string) => owner.waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "approval.requested");
  async function ask(task: string, agent: string, command: string) {
    let calls = 0;
    provider.reply = () => (++calls === 1 ? bashUseSse(command) : sse([{ type: "text", text: "done" }]));
    owner.send("agent.create", { id: agent, name: agent, provider: "main", model: "model-a" });
    await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === agent));
    owner.send("task.message", { agent, id: `${task}-m`, text: "go" }, task);
    const asked = await requested(task);
    return (asked.body as { body: { request: string; command: string } }).body;
  }

  // Approve: the command the Owner allowed runs on the Machine.
  const approved = await ask("task-approve", "agent-approve", "touch approved-marker");
  expect(approved.command).toBe("touch approved-marker");
  const marker = join(home, "agents", "agent-approve", "workdir", "approved-marker");
  expect(await Bun.file(marker).exists()).toBe(false);
  owner.send("approval.answer", { agent: "agent-approve", request: approved.request, decision: "approve" }, "task-approve");
  await owner.waitFor((m) => m.type === "task.event" && m.task === "task-approve" && m.body.kind === "turn.ended");
  expect(await Bun.file(marker).exists()).toBe(true);
  expect(events("task-approve", "approval.answered").map((m) => (m.body as { body: { decision: string } }).body)).toMatchObject([{ decision: "approve" }]);

  // Deny: the command never runs, and the LLM hears why.
  const denied = await ask("task-deny", "agent-deny", "touch denied-marker");
  owner.send("approval.answer", { agent: "agent-deny", request: denied.request, decision: "deny" }, "task-deny");
  await owner.waitFor((m) => m.type === "task.event" && m.task === "task-deny" && m.body.kind === "turn.ended");
  expect(await Bun.file(join(home, "agents", "agent-deny", "workdir", "denied-marker")).exists()).toBe(false);
  const followUp = provider.requests.filter((r) => r.path === "/v1/messages").at(-1)!.body as { messages: { content: { type: string; content?: string; is_error?: boolean }[] }[] };
  const results = followUp.messages.at(-1)!.content.filter((b) => b.type === "tool_result");
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ is_error: true });
  expect(results[0]!.content).toContain("denied");
  owner.client.stop();
}, 90_000);

test("a Stop from the Controller ends the Turn and kills the command it was running", async () => {
  const owner = controller();
  await owner.ready;
  owner.send("agent.create", { id: "agent-stop", name: "Stopper", provider: "main", model: "model-a", allowlist: ["sleep 300", "touch"] });
  await owner.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-stop"));

  // If the command outlived the Stop, this file would appear: it is written only after the sleep.
  const survivor = join(home, "agents", "agent-stop", "workdir", "survived-stop");
  let calls = 0;
  provider.reply = () => (++calls === 1 ? bashUseSse("sleep 300 && touch survived-stop") : sse([{ type: "text", text: "stopped" }]));
  owner.send("task.message", { agent: "agent-stop", id: "stop-1", text: "run it" }, "task-stop");
  await owner.waitFor((m) => m.type === "task.event" && m.task === "task-stop" && (m.body as { kind: string }).kind === "llm.message");
  await Bun.sleep(400);
  expect(await Bun.file(survivor).exists()).toBe(false);

  owner.send("task.stop", { agent: "agent-stop", id: "stop-cmd-1" }, "task-stop");
  const ended = await owner.waitFor((m) => m.type === "task.event" && m.task === "task-stop" && (m.body as { kind: string }).kind === "turn.ended");
  expect((ended.body as { body: unknown }).body).toEqual({ reason: "stopped" });
  const kinds = owner.inbox.filter((m) => m.type === "task.event" && m.task === "task-stop").map((m) => (m.body as { kind: string }).kind);
  expect(kinds.slice(-2)).toEqual(["turn.stopped", "turn.ended"]);
  // The command was cut off, so it reports no result and never writes its file.
  expect(kinds).not.toContain("tool.result");
  expect(await Bun.file(survivor).exists()).toBe(false);

  // The same Task talks again right away.
  owner.send("task.message", { agent: "agent-stop", id: "stop-2", text: "carry on" }, "task-stop");
  const next = await owner.waitFor((m) => m.type === "task.event" && m.task === "task-stop" && (m.body as { kind: string }).kind === "turn.ended" && (m.body as { seq: number }).seq > (ended.body as { seq: number }).seq);
  expect((next.body as { body: unknown }).body).toEqual({ reason: "done" });
  owner.client.stop();
}, 90_000);
