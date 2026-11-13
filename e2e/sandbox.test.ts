import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, publicKeyOf, toBase64url, type KnownMessage } from "@veeloe/protocol-ts";
import { startHubClient } from "../controller/src/shared/hub-client";
import { FAKE_KEY, fakeProvider, message } from "./helpers/fake-provider";
import { buildRuntime } from "../scripts/runtime";

// The compiled `veeloe` in the real OS sandbox (Seatbelt on macOS, bubblewrap on
// Linux), with a stand-in Provider that asks for `bash` with whatever the Member
// wrote, so each message is one command an Agent runs (ADR 0008). The checks
// try to get out. TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));

// Real paths: on macOS the temporary folder is reached through a symlink, and the sandbox goes by where things are.
const work = realpathSync(mkdtempSync(join(tmpdir(), "veeloe-e2e-sandbox-")));
const home = join(work, "home");
const user = join(work, "user");
/** The Rust debug binary this file drives, built by `scripts/runtime.ts`. */
let runtimeBinary: string;
const running: ReturnType<typeof Bun.spawn>[] = [];
const provider = fakeProvider();
let url: string;
let supervisorPid = 0;

/** The SSE of one message that asks for `bash` with `command`. */
function askBash(id: string, command: string) {
  const start = { ...message([], "tool_use"), content: [] };
  const events = [
    { type: "message_start", message: start },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "bash", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command }) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

/** The SSE of one message that asks for `name` with `input`. */
function askTool(id: string, name: string, input: unknown) {
  const start = { ...message([], "tool_use"), content: [] };
  const events = [
    { type: "message_start", message: start },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

let uses = 0;
provider.reply = (body) => {
  const last = (body.messages as { role: string; content: { type: string; text?: string }[] }[]).at(-1)!;
  const text = last.content.find((block) => block.type === "text")?.text;
  // The Member's words are the command; once its result is back, the Agent just says so.
  if (text) return askBash(`toolu_${++uses}`, text);
  return new Response(
    [
      { type: "message_start", message: { ...message([]), content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ran it" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
};

beforeAll(async () => {
  const hubBinary = join(work, "testhub");
  const built = Bun.spawnSync(["go", "build", "-o", hubBinary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  runtimeBinary = buildRuntime();
  const hub = Bun.spawn([hubBinary], { stdout: "pipe", stderr: "inherit" });
  running.push(hub);
  const { value } = await (hub.stdout as ReadableStream<Uint8Array>).getReader().read();
  url = new TextDecoder().decode(value).trim();

  // The owner's home, with a key no Agent may read.
  mkdirSync(join(user, ".ssh"), { recursive: true, mode: 0o700 });
  writeFileSync(join(user, ".ssh/id_ed25519"), "SSH-SECRET-FOR-THE-TEST", { mode: 0o600 });

  // What `veeloe pair` would have left, for the keys cmd/testhub knows.
  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "machine.key"), machineSeed, { mode: 0o600 });
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: url }), { mode: 0o600 });
  writeFileSync(join(home, "runtime/trust.json"), JSON.stringify({ owners: [{ member: "member-1", keys: [toBase64url(publicKeyOf(controllerSeed))] }] }), { mode: 0o600 });
  chmodSync(home, 0o700);

  const add = Bun.spawn([runtimeBinary, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
  add.stdin.write(FAKE_KEY);
  await add.stdin.end();
  if ((await add.exited) !== 0) throw new Error(await new Response(add.stdout).text());

  const supervisor = Bun.spawn([runtimeBinary], { env: { VEELOE_HOME: home, HOME: user, PATH: process.env.PATH }, stdout: "pipe", stderr: "inherit" });
  running.push(supervisor);
  supervisorPid = supervisor.pid;
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

type Message = KnownMessage & { task?: string };

function controller() {
  const inbox: Message[] = [];
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
  const waitFor = async (match: (m: Message) => boolean, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = inbox.find(match);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`nothing matched; got ${inbox.map((m) => (m.type === "task.event" ? `task.event:${m.body.kind}` : m.type)).join(", ")}`);
  };
  return { client, ready: ready.promise, inbox, send, waitFor };
}

let c: ReturnType<typeof controller>;
let n = 0;

/** What a test does when the proxy asks about a domain outside the Egress. */
type DomainAnswer = "approve" | "always" | "deny" | "forbid";

/**
 * Has Agent A run `command` as one Turn, and gives back what `bash` returned.
 * Each command asks once, then a domain outside the Egress asks again
 * (issue #44): `domain` says what the Owner does with that second card.
 */
async function run(command: string, agent = "agent-a", domain: DomainAnswer = "deny") {
  const task = `task-${++n}`;
  c.send("task.message", { agent, id: `m-${n}`, text: command }, task);
  // This file tests the sandbox, not the Allowlist: answer each command at once
  // so it reaches the sandbox instead of waiting for a human. A domain approval
  // is answered by the test's `domain` choice, and `forbid` says none may come.
  const answered = new Set<string>();
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ended = c.inbox.find((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended");
    const approval = c.inbox.find(
      (m) =>
        m.type === "task.event" &&
        m.task === task &&
        m.body.kind === "approval.requested" &&
        !answered.has((m.body.body as { request: string }).request),
    );
    if (approval?.type === "task.event") {
      const body = approval.body.body as { request: string; kind?: string; domain?: string };
      answered.add(body.request);
      if (body.kind === "domain") {
        if (domain === "forbid") throw new Error(`a domain approval was asked for ${body.domain}, and this Turn must not ask`);
        c.send("approval.answer", { agent, request: body.request, decision: domain }, task);
      } else {
        c.send("approval.answer", { agent, request: body.request, decision: "approve" }, task);
      }
      continue;
    }
    if (ended) break;
    if (Date.now() > deadline) throw new Error(`the Turn did not end: ${task}`);
    await Bun.sleep(20);
  }
  const ended = await c
    .waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended")
    .catch((error: Error) => {
      const mine = c.inbox.filter((m) => m.task === task).map((m) => (m.type === "task.event" ? `task.event:${m.body.kind}` : m.type));
      throw new Error(`${error.message} | ${task}: ${mine.join(", ")}`);
    });
  expect(ended.type === "task.event" && ended.body.body).toEqual({ reason: "done" });
  const result = await c.waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "tool.result");
  const [first] = (result.type === "task.event" ? (result.body.body as { content: { content: string; is_error?: boolean }[] }).content : []) as { content: string; is_error?: boolean }[];
  return { output: first!.content, failed: first!.is_error === true };
}

test("an Agent runs commands in its sandbox and cannot get out of it", async () => {
  c = controller();
  await c.ready;
  for (const id of ["agent-a", "agent-b"]) {
    c.send("agent.create", { id, name: id, provider: "main", model: "model-a" });
    await c.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === id));
  }
  const listed = await c.waitFor((m) => m.type === "agent.listed" && m.body.agents.length === 2);
  expect(listed.type === "agent.listed" && listed.body.egress).toEqual([]);
  // Each Agent's own list is empty too: A new Agent starts with no way out (issue #43).
  expect(listed.type === "agent.listed" && listed.body.agents.map((a) => a.egress)).toEqual([[], []]);

  // Its Workdir, and nothing it does there carries to the next command.
  expect(await run("pwd")).toEqual({ output: `${join(home, "agents/agent-a/workdir")}\nexit code: 0`, failed: false });
  expect((await run("echo hello > hello.txt && cat hello.txt")).output).toBe("hello\nexit code: 0");

  // Secrets, the Runtime's own files and another Agent's folder, directly or through a link.
  const secrets = [`cat ${user}/.ssh/id_ed25519`, `ln -s ${user}/.ssh/id_ed25519 key-link && cat key-link`, `cat ${home}/runtime/providers.json`, `cat ${home}/machine.key`, `ls ${home}/agents/agent-b/workdir`];
  for (const command of secrets) {
    const result = await run(command);
    expect([command, result.failed]).toEqual([command, true]);
    expect(result.output).not.toContain("SSH-SECRET");
    expect(result.output).not.toContain(FAKE_KEY);
  }
  // Other files on the Machine stay readable.
  expect((await run("head -c 1 /etc/hosts >/dev/null")).failed).toBe(false);

  // Writing outside its own folder, directly or through a link.
  expect((await run(`echo x > ${user}/.zshrc`)).failed).toBe(true);
  expect((await run(`echo x > ${home}/agents/agent-b/workdir/x`)).failed).toBe(true);
  expect((await run(`ln -s ${user}/planted out-link && echo x > out-link`)).failed).toBe(true);
  expect(existsSync(join(user, ".zshrc")) || existsSync(join(user, "planted")) || existsSync(join(home, "agents/agent-b/workdir/x"))).toBe(false);

  // The supervisor is out of reach.
  expect((await run(`kill -0 ${supervisorPid}`)).failed).toBe(true);

  // No network but the Egress, which starts empty, and never this Machine's own ports.
  expect((await run(`curl -sS -m 5 ${provider.url}/v1/models`)).failed).toBe(true);
  expect((await run("curl -sS -m 10 -o /dev/null https://example.com")).failed).toBe(true);
}, 240_000);

// Both systems reach the same proxy, by the one way each has: macOS over the
// proxy's loopback port, which its profile allows out, and Linux over a Unix
// socket bound into the namespace, where the worker's bridge forwards loopback
// traffic to it (ADR 0069, issue #42).
test("a domain the owner adds to the Egress opens at once for every Agent, and closes when taken out", async () => {
  c.send("egress.set", { egress: ["example.com"] });
  await c.waitFor((m) => m.type === "agent.listed" && m.body.egress?.includes("example.com") === true);
  for (const agent of ["agent-a", "agent-b"]) expect(await run("curl -sS -m 20 -o /dev/null -w '%{http_code}' https://example.com", agent)).toEqual({ output: "200\nexit code: 0", failed: false });
  // An address is never a domain, so it never gets into the list.
  c.send("egress.set", { egress: ["127.0.0.1"] });
  await c.waitFor((m) => m.type === "error" && m.body.code === "egress.invalid_domain");

  c.send("egress.set", { egress: [] });
  await c.waitFor((m) => m.type === "agent.listed" && m.body.egress?.length === 0);
  expect((await run("curl -sS -m 10 -o /dev/null https://example.com")).failed).toBe(true);
}, 120_000);

// Issue #43: the Egress belongs to one Agent. A reaches what it was given; B,
// whose list is empty, does not, and B's proxy is its own listener, so it never
// answers for A either (ADR 0029).
test("one Agent's Egress opens for it alone", async () => {
  // B gets a domain of its own first, so every later answer names a state the
  // older ones never had and the checks cannot read a stale list.
  c.send("egress.set", { agent: "agent-b", egress: ["example.org"] });
  await c.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-b" && a.egress?.includes("example.org") === true));

  c.send("egress.set", { agent: "agent-a", egress: ["example.com"] });
  const listed = await c.waitFor(
    (m) =>
      m.type === "agent.listed" &&
      m.body.agents.some((a) => a.id === "agent-a" && a.egress?.includes("example.com") === true) &&
      m.body.agents.some((a) => a.id === "agent-b" && a.egress?.includes("example.org") === true),
  );
  if (listed.type !== "agent.listed") throw new Error("no list");
  const own = (id: string) => listed.body.agents.find((a) => a.id === id)?.egress;
  expect(own("agent-a")).toEqual(["example.com"]);
  expect(own("agent-b")).toEqual(["example.org"]);
  // The top-level list is the union, for a Controller that reads only that shape.
  expect(listed.body.egress).toEqual(["example.com", "example.org"]);

  expect(await run("curl -sS -m 20 -o /dev/null -w '%{http_code}' https://example.com", "agent-a")).toEqual({ output: "200\nexit code: 0", failed: false });
  expect((await run("curl -sS -m 10 -o /dev/null https://example.com", "agent-b")).failed).toBe(true);

  // Taking it out of A closes A, and still leaves B as it was.
  c.send("egress.set", { agent: "agent-a", egress: [] });
  await c.waitFor((m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-a" && a.egress?.length === 0) && m.body.agents.some((a) => a.id === "agent-b" && a.egress?.includes("example.org") === true));
  expect((await run("curl -sS -m 10 -o /dev/null https://example.com", "agent-a")).failed).toBe(true);

  // Leave both as the next file expects to find them.
  c.send("egress.set", { agent: "agent-b", egress: [] });
  await c.waitFor((m) => m.type === "agent.listed" && m.body.egress?.length === 0);
}, 240_000);

// Issue #44: a domain outside the Egress asks the Owner instead of being
// dropped. Approve opens this connection only; Always also writes the domain
// into that Agent's Egress, so the next request does not ask again and the
// other Agent still does.
test("a domain outside the Egress asks, and a permanent yes is remembered for that Agent alone", async () => {
  const curl = "curl -sS -m 20 -o /dev/null -w '%{http_code}' https://example.com";

  // One connection, allowed once: the domain is not written anywhere.
  expect(await run(curl, "agent-a", "approve")).toEqual({ output: "200\nexit code: 0", failed: false });
  const beforeOnce = c.inbox.length;
  c.send("agent.list", {});
  const afterOnce = await c.waitFor(
    (m) => c.inbox.indexOf(m) >= beforeOnce && m.type === "agent.listed" && m.body.agents.length === 2 && m.body.agents.every((a) => (a.egress ?? []).length === 0),
  );
  expect(afterOnce.type).toBe("agent.listed");

  // A permanent yes: example.com goes into A's Egress, not B's.
  expect(await run(curl, "agent-a", "always")).toEqual({ output: "200\nexit code: 0", failed: false });
  const beforeAlways = c.inbox.length;
  c.send("agent.list", {});
  const afterAlways = await c.waitFor(
    (m) =>
      c.inbox.indexOf(m) >= beforeAlways &&
      m.type === "agent.listed" &&
      m.body.agents.some((a) => a.id === "agent-a" && a.egress?.includes("example.com") === true) &&
      m.body.agents.some((a) => a.id === "agent-b" && (a.egress ?? []).length === 0),
  );
  expect(afterAlways.type).toBe("agent.listed");

  // The next request does not ask: `forbid` fails the Turn if a card appears.
  expect(await run(curl, "agent-a", "forbid")).toEqual({ output: "200\nexit code: 0", failed: false });

  // The other Agent never got the permanent yes: it asks, and a deny closes it.
  expect((await run(curl, "agent-b", "deny")).failed).toBe(true);

  // Leave the next file the empty Egress it expects.
  const beforeClear = c.inbox.length;
  c.send("egress.set", { agent: "agent-a", egress: [] });
  await c.waitFor((m) => c.inbox.indexOf(m) >= beforeClear && m.type === "agent.listed" && m.body.agents.some((a) => a.id === "agent-a" && (a.egress ?? []).length === 0));
}, 240_000);

/** The SSE of one finished answer that just says `text`. */
function say(text: string) {
  const events = [
    { type: "message_start", message: { ...message([]), content: [] } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

/** An answer that asks for one tool on the first request, then says it is done. */
function toolReply(name: string, input: unknown) {
  let asked = false;
  return (body: { model?: string; messages?: unknown[]; stream?: boolean }) => {
    const last = (body.messages ?? []).at(-1) as { content: { type: string; text?: string }[] } | undefined;
    if (!asked && last?.content.some((block) => block.type === "text")) {
      asked = true;
      return askTool(`toolu_${++uses}`, name, input);
    }
    return say("done");
  };
}

async function runFileTool() {
  const task = `task-${++n}`;
  c.send("task.message", { agent: "agent-a", id: `m-${n}`, text: "go" }, task);
  const ended = await c.waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "turn.ended");
  expect(ended.type === "task.event" && ended.body.body).toEqual({ reason: "done" });
  const result = await c.waitFor((m) => m.type === "task.event" && m.task === task && m.body.kind === "tool.result");
  const [first] = (result.type === "task.event" ? (result.body.body as { content: { content: string; is_error?: boolean }[] }).content : []) as { content: string; is_error?: boolean }[];
  return { output: first!.content, failed: first!.is_error === true };
}

test("file tools refuse a path outside the Workdir inside the real sandbox", async () => {
  const workdir = join(home, "agents/agent-a/workdir");
  if (!existsSync(join(workdir, "key-link"))) symlinkSync(join(user, ".ssh/id_ed25519"), join(workdir, "key-link"));
  const original = provider.reply;

  provider.reply = toolReply("read", { path: "key-link" });
  const read = await runFileTool();
  expect(read.failed).toBe(true);
  expect(read.output).not.toContain("SSH-SECRET");

  provider.reply = toolReply("write", { path: "../agent-b/workdir/x", content: "x" });
  const write = await runFileTool();
  expect(write.failed).toBe(true);
  expect(existsSync(join(home, "agents/agent-b/workdir/x"))).toBe(false);

  rmSync(join(workdir, "key-link"), { force: true });
  provider.reply = original;
}, 120_000);
