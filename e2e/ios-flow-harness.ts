// The world the iOS flow tests (5.8b-2b, 5.8b-2c) run against, outside the app:
// the real Hub API on Postgres, the real Rust `veeloe` supervisor and worker, and
// a stand-in Provider. Run as a script, not through `bun test`: it is what the
// simulator talks to while a test drives the app.
//
//   bun e2e/ios-flow-harness.ts check   # prove the wiring, print PASS, exit
//   bun e2e/ios-flow-harness.ts serve   # keep the Hub and Runtime up for a simulator
//
// `serve` prints one line of JSON to start with — `HARNESS {hubUrl, link, home}` —
// and a second one once the app has paired and the Machine is on the Hub:
// `MACHINE READY {hubUrl, home}`.
//
// Why the real API and not `hub/cmd/testhub`: `cmd/testhub` only knows two fixed
// key seeds, and the app's key comes out of the keychain, so it could never
// authenticate there. The Hub API needs Postgres — `make docker-up` and
// `make migrate-up` in `hub/`, which is the same database `e2e/pairing.test.ts` uses.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, parseMessage, parsePairingLink, type KnownMessage } from "@veeloe/protocol-ts";
import { pairMachine } from "../controller/src/pages/add-machine/model/pair";
import { startHubClient } from "../controller/src/shared/hub-client";
import { FAKE_KEY, fakeProvider, sse } from "./helpers/fake-provider";
import { buildRuntime } from "../scripts/runtime";

const repo = `${import.meta.dir}/..`;
const mode = process.argv[2] ?? "check";
const dsn = process.env.DB_DSN ?? "postgres://postgres:postgres@localhost:5432/hub?sslmode=disable";

const running: ReturnType<typeof Bun.spawn>[] = [];
const work = mkdtempSync(join(tmpdir(), "veeloe-ios-harness-"));

/** A step for the operator, so a failing run says where it got to. */
function step(line: string) {
  console.log(`  ${line}`);
}

function shutdown(code: number): never {
  running.forEach((proc) => {
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  });
  provider?.server.stop(true);
  if (mode === "check") rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

const provider = fakeProvider();

/** One line at a time from a child's stdout, with a deadline: a silenced pipe is a failure, not a wait. */
function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async function until(match: (line: string) => boolean, what: string, ms = 60_000): Promise<string> {
    const end = Date.now() + ms;
    while (true) {
      const at = buffer.indexOf("\n");
      if (at >= 0) {
        const line = buffer.slice(0, at).trimEnd();
        buffer = buffer.slice(at + 1);
        if (match(line)) return line;
        continue;
      }
      const left = end - Date.now();
      if (left <= 0) throw new Error(`waited ${ms} ms for ${what}; the child had said:\n${buffer}`);
      const read = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]);
      if (read === null) throw new Error(`waited ${ms} ms for ${what}; the child had said:\n${buffer}`);
      if (read.done) throw new Error(`the child ended before ${what}; it had said:\n${buffer}`);
      buffer += decoder.decode(read.value, { stream: true });
    }
  };
}

async function freePort(): Promise<number> {
  // Ask the kernel for one, then let go of it; the Hub binds it a moment later.
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("no free port");
  return port;
}

type Hub = { url: string; http: string; proc: ReturnType<typeof Bun.spawn> };

/** Builds and starts the real Hub API. It refuses to boot on a database that was never migrated. */
async function startHub(): Promise<Hub> {
  const binary = join(work, "hub");
  const built = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/api"], { cwd: `${repo}/hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}`;
  const proc = Bun.spawn([binary], {
    env: { ...process.env, PORT: String(port), DB_DSN: dsn, HUB_PUBLIC_URL: url, APP_ENV: "development" },
    stdout: "inherit",
    stderr: "inherit",
  });
  running.push(proc);
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const up = await fetch(`http://127.0.0.1:${port}/readyz`).then((answer) => answer.ok, () => false);
    if (up) return { url, http: `http://127.0.0.1:${port}`, proc };
    await Bun.sleep(100);
  }
  throw new Error(`the Hub did not come up on ${url} (is Postgres up and migrated?)`);
}

/**
 * `veeloe pair --hub` in its own home, showing the link it waits on. The Machine
 * key is the one the file already holds, so a seeded home pairs as that key.
 */
async function startPair(hub: Hub, home: string) {
  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
  const proc = Bun.spawn([runtimeBinary(), "pair", "--hub", hub.url], {
    env: { VEELOE_HOME: home, PATH: process.env.PATH, HOME: process.env.HOME },
    stdout: "pipe",
    stderr: "inherit",
  });
  running.push(proc);
  const line = await lineReader(proc.stdout)((text) => text.includes("veeloe://"), "the pairing link");
  const link = parsePairingLink(line.slice(line.indexOf("veeloe://")).trim(), Date.now());
  if (!link.ok) throw new Error(`the link will not parse: ${link.reason}`);
  step(`link ${link.link.machine.slice(0, 12)}… for ${hub.url}`);
  return { proc, link: link.link, text: line.slice(line.indexOf("veeloe://")).trim() };
}

/** The key goes in on stdin, never as an argument (ADR 0042, 0065). */
async function addProvider(home: string, url: string) {
  const add = Bun.spawn([runtimeBinary(), "provider", "add", "--name", "main", "--url", url], {
    env: { VEELOE_HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  add.stdin.write(FAKE_KEY);
  await add.stdin.end();
  if ((await add.exited) !== 0) throw new Error("`veeloe provider add` failed");
  const list = Bun.spawnSync([runtimeBinary(), "provider", "list"], { env: { VEELOE_HOME: home } });
  const said = list.stdout.toString();
  if (!said.includes("main") || !said.includes(url)) throw new Error(`provider list does not name it: ${said}`);
  step(`provider main -> ${url}`);
}

/** The supervisor itself, waiting until the Hub has taken its key again. */
async function startSupervisor(home: string, hub: Hub) {
  const proc = Bun.spawn([runtimeBinary()], {
    env: { VEELOE_HOME: home, PATH: process.env.PATH, HOME: process.env.HOME },
    stdout: "pipe",
    stderr: "inherit",
  });
  running.push(proc);
  const line = await lineReader(proc.stdout)((text) => text.startsWith("connected to hub"), "the Machine on the Hub", 90_000);
  if (!line.includes(hub.url)) throw new Error(`the supervisor connected somewhere else: ${line}`);
  step(line);
  return proc;
}

/** A Controller on the relay, collecting what the Machine signed for it. */
function controller(hub: Hub, secretKey: Uint8Array, machineKey: string) {
  const inbox: (KnownMessage & { task?: string })[] = [];
  const ready = Promise.withResolvers<string>();
  const client = startHubClient({
    hubUrl: hub.url,
    secretKey,
    trustedKeys: new Set([machineKey]),
    onReady: (member) => ready.resolve(member),
    onEnvelope: ({ signed }) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, task: signed.task });
    },
  });
  return { client, ready: ready.promise, inbox };
}

let built: string | undefined;
/** The `veeloe` binary, built once per run. */
function runtimeBinary(): string {
  built ??= buildRuntime();
  return built;
}

try {
  if (mode === "check") await check();
  else if (mode === "serve") await serve();
  else {
    console.error(`usage: bun e2e/ios-flow-harness.ts [check | serve]`);
    shutdown(2);
  }
} catch (error) {
  // Kill what is still up before saying why: a Hub left holding the pipe hides it.
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
}

/**
 * The whole wiring, with no app in it: a Machine pairs through the real Hub, comes
 * back as a supervisor, and a Controller's `agent.list`, `agent.create` and
 * `task.list` are answered. Anything that fails here would fail under the app too.
 */
async function check() {
  const hub = await startHub();
  step(`hub ${hub.url}`);

  const home = join(work, "machine");
  const { proc, link } = await startPair(hub, home);

  // The Controller's half, the same one the app ported: POST /pairings, then a
  // claim over the relay until the Machine answers with a signed `pairing.done`.
  const secretKey = generateSecretKey();
  const paired = await pairMachine({ link, secretKey, retryMs: 300, giveUpAt: Date.now() + 45_000 });
  if (!paired.ok) throw new Error(`pairing failed: ${paired.code}`);
  if ((await proc.exited) !== 0) throw new Error("`veeloe pair` did not exit cleanly after pairing");
  step(`paired as ${paired.machine.member}, machine ${paired.machine.id}`);

  await addProvider(home, provider.url);
  await startSupervisor(home, hub);

  const machineId = paired.machine.id;
  const me = controller(hub, secretKey, link.machine);
  const member = await me.ready;
  const send = (type: string, body: unknown) => me.client.send({ type, to: machineId, member, body });
  const waitFor = async (match: (message: KnownMessage & { task?: string }) => boolean, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = me.inbox.find(match);
      if (found) return found;
      await Bun.sleep(25);
    }
    throw new Error(`nothing matched; the Machine sent ${me.inbox.map((message) => message.type).join(", ") || "nothing"}`);
  };

  send("agent.list", {});
  const listed = await waitFor((message) => message.type === "agent.listed");
  const providers = listed.type === "agent.listed" ? (listed.body as { providers: { name: string }[] }).providers : [];
  if (!providers.some((entry) => entry.name === "main")) throw new Error(`agent.listed does not name the Provider: ${JSON.stringify(listed.body)}`);
  step("agent.list -> agent.listed (provider main)");

  send("agent.create", { id: "harness-agent", name: "Harness", provider: "main", model: "model-a" });
  const created = await waitFor((message) => message.type === "agent.listed" && (message.body as { agents: { id: string }[] }).agents.some((agent) => agent.id === "harness-agent"));
  step("agent.create -> agent.listed (harness-agent)");

  send("task.list", {});
  const tasks = await waitFor((message) => message.type === "task.listed");
  const count = tasks.type === "task.listed" ? (tasks.body as { tasks: unknown[] }).tasks.length : -1;
  step(`task.list -> task.listed (${count} tasks)`);

  me.client.stop();
  console.log("PASS");
  shutdown(0);
}

/**
 * For a simulator: the Hub and a link, then — once the app has paired into the
 * same home — the Provider and the supervisor, and it stays up until killed.
 */
/** The SSE a Provider streams for one message that asks for one `bash` command. */
function bashUseSse(command: string) {
  const start = JSON.stringify({ type: "message_start", message: { id: "msg_bash", type: "message", role: "assistant", model: "model-a", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const block = JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "bash", input: { command } } });
  const delta = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command }) } });
  const stop = JSON.stringify({ type: "content_block_stop", index: 0 });
  const end = JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } });
  return new Response([start, block, delta, stop, end, '{"type":"message_stop"}'].map((data) => `event: x\ndata: ${data}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

async function serve() {
  // 5.8b-2c: the first message asks for a command outside the Agent's
  // Allowlist, so the app must answer an Approval; the command then runs long
  // enough for the app's Stop to end the Turn.
  let answered = 0;
  provider.reply = () => {
    answered += 1;
    if (answered === 1) return bashUseSse("sleep 300 && touch survived-stop");
    return sse([{ type: "text", text: "done" }]);
  };
  const hub = await startHub();
  const home = join(work, "machine");
  const { link, text } = await startPair(hub, home);
  console.log(`HARNESS ${JSON.stringify({ hubUrl: hub.url, http: hub.http, link: text, home })}`);

  // The app writes its trust when it pairs; the Runtime can only start after that.
  const trust = join(home, "runtime/trust.json");
  const end = Date.now() + 20 * 60_000;
  while (Date.now() < end) {
    if (existsSync(trust)) {
      const owners = (JSON.parse(readFileSync(trust, "utf8")) as { owners?: unknown[] }).owners ?? [];
      if (owners.length > 0) break;
    }
    await Bun.sleep(500);
  }
  if (!existsSync(trust)) throw new Error("the app never paired; no trust.json in the Machine's home");
  step("the app paired");

  await addProvider(home, provider.url);
  await startSupervisor(home, hub);
  chmodSync(home, 0o700);
  console.log(`MACHINE READY ${JSON.stringify({ hubUrl: hub.url, http: hub.http, home })}`);

  await new Promise(() => {
    process.on("SIGINT", () => shutdown(0));
    process.on("SIGTERM", () => shutdown(0));
  });
}
