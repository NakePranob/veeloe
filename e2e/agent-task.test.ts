import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, publicKeyOf, toBase64url, type KnownMessage } from "@veeloe/protocol";
import { startHubClient } from "../controller/src/shared/hub-client";
import { FAKE_KEY, fakeProvider } from "../packages/runtime/src/supervisor/providers/fake-provider";

// The compiled `veeloe`, its workers and its proxy, through the real relay, with
// the Controller's own client and a stand-in Provider. TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));

const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-agent-"));
const home = join(work, "home");
const veeloe = join(work, "veeloe");
const running: ReturnType<typeof Bun.spawn>[] = [];
const provider = fakeProvider();
let url: string;

beforeAll(async () => {
  const hubBinary = join(work, "testhub");
  const built = Bun.spawnSync(["go", "build", "-o", hubBinary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  const runtime = Bun.spawnSync(["bun", "build", `${import.meta.dir}/../packages/runtime/src/main.ts`, "--compile", "--outfile", veeloe], { stdout: "ignore", stderr: "inherit" });
  if (!runtime.success) throw new Error("could not build the Runtime");
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

  const add = Bun.spawn([veeloe, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: new Blob([FAKE_KEY]), stdout: "pipe" });
  if ((await add.exited) !== 0) throw new Error(await new Response(add.stdout).text());

  const supervisor = Bun.spawn([veeloe], { env: { VEELOE_HOME: home, PATH: process.env.PATH }, stdout: "pipe", stderr: "inherit" });
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
