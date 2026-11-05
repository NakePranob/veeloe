import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, MemorySeenSequences, parseMessage, publicKeyOf, toBase64url, verify, type KnownMessage } from "@veeloe/protocol";
import { startSupervisor } from ".";
import { fakeHub, type FakeHub } from "./hub-link/fake-hub";
import { runUnpair } from "./pairing/unpair";
import { FAKE_KEY, fakeProvider, type FakeProvider } from "./providers/fake-provider";
import { saveProviders } from "./providers/store";
import { saveTrust } from "./trust/store";

// The supervisor with its real workers, a stand-in Hub and a stand-in Provider. TEST-ONLY KEYS.
const machineSeed = new Uint8Array(32).fill(0x33);
const ownerSeed = new Uint8Array(32).fill(0x44);
const secondOwnerSeed = new Uint8Array(32).fill(0x45);
const strangerSeed = new Uint8Array(32).fill(0x22);
const key = (seed: Uint8Array) => toBase64url(publicKeyOf(seed));
const workerCommand = [process.execPath, join(import.meta.dir, "../main.ts")];

// No OS sandbox in these tests: e2e runs the real one. This one only remembers the Egress it was given.
const egressGiven: string[][] = [];
const passThrough = { wrap: async (argv: string[]) => argv, setEgress: (domains: string[]) => void egressGiven.push(domains) };

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

let seq = 1;
type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(home = mkdtempSync(join(tmpdir(), "veeloe-flow-")), provider: FakeProvider = fakeProvider()) {
  saveTrust(home, { owners: [{ member: "m_1", keys: [key(ownerSeed)] }, { member: "m_2", keys: [key(secondOwnerSeed)] }] });
  saveProviders(home, [{ name: "main", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }]);
  const hub: FakeHub = fakeHub();
  const lines: string[] = [];
  const running = startSupervisor({ home, hubUrl: hub.url, secretKey: machineSeed, workerCommand, sandbox: passThrough, log: (l) => lines.push(l) });
  cleanup.push(() => {
    running.stop();
    hub.server.stop(true);
  });
  await until(() => lines.some((l) => l.includes("connected to hub")));

  const seen = new MemorySeenSequences();
  /** Signed frames the Machine sent to `member`, read and verified like a Controller would. */
  const received = (member = "m_1") =>
    hub.frames.flatMap((frame) => {
      const result = verify(frame, new Set([key(machineSeed)]), (route) => "recipients" in route && route.recipients.includes(member), seen);
      if (!result.ok) return [];
      const parsed = parseMessage(result.signed);
      return parsed.kind === "message" ? [{ ...parsed.message, task: result.signed.task }] : [];
    });
  const inbox: Record<string, (KnownMessage & { task?: string })[]> = { m_1: [], m_2: [] };
  const read = (member = "m_1") => {
    inbox[member]!.push(...received(member));
    hub.frames.length = 0;
    return inbox[member]!;
  };
  const send = (type: string, body: unknown, { seed = ownerSeed, member = "m_1", task }: { seed?: Uint8Array; member?: string; task?: string } = {}) =>
    hub.send(createSigner(seed, () => seq++)({ type, to: "machine-1", member, ...(task ? { task } : {}), body }));
  const waitFor = async <T extends KnownMessage["type"]>(type: T, member = "m_1", where: (m: Extract<KnownMessage, { type: T }>) => boolean = () => true) => {
    let found: Extract<KnownMessage, { type: T }> | undefined;
    await until(() => !!(found = read(member).find((m): m is Extract<KnownMessage, { type: T }> & { task?: string } => m.type === type && where(m as never))), 8000);
    return found!;
  };
  return { home, hub, provider, lines, running, send, read, waitFor };
}

async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

async function createAgent(s: Setup, id: string) {
  s.send("agent.create", { id, name: id, provider: "main", model: "model-a" });
  return s.waitFor("agent.listed", "m_1", (m) => m.body.agents.some((a) => a.id === id));
}

async function talk(s: Setup, agent: string, task: string, text: string) {
  s.send("task.message", { agent, id: `${task}-${text}`, text }, { task });
  const ended = await s.waitFor("task.event", "m_1", (m) => m.body.kind === "turn.ended" && (m as { task?: string }).task === task);
  expect(ended.body.body).toEqual({ reason: "done" });
}

test("the owner gets the list with the Provider's models, and never its URL or key", async () => {
  const s = await setup();
  s.send("agent.list", {});
  const listed = await s.waitFor("agent.listed");
  expect(listed.body).toEqual({ agents: [], providers: [{ name: "main", models: [{ id: "model-a", name: "Model A" }, { id: "model-b" }] }], egress: [] });
  expect(JSON.stringify(listed)).not.toContain(FAKE_KEY);
  expect(JSON.stringify(listed)).not.toContain(s.provider.url);
});

test("a key not in trust, or a header naming another Member, is dropped without an answer", async () => {
  const s = await setup();
  s.send("agent.list", {}, { seed: strangerSeed });
  s.send("agent.list", {}, { member: "m_2" });
  await until(() => s.lines.includes("dropped an envelope: untrusted-key") && s.lines.includes("dropped an envelope: member-mismatch"));
  await Bun.sleep(100);
  expect([...s.read("m_1"), ...s.read("m_2")]).toEqual([]);
});

test("an Agent is made once with its Workdir, and a Provider or model the Machine lacks is refused", async () => {
  const s = await setup();
  s.send("agent.create", { id: "a1", name: "A", provider: "nope", model: "model-a" });
  expect((await s.waitFor("error")).body.code).toBe("agent.provider_unknown");
  s.send("agent.create", { id: "a1", name: "A", provider: "main", model: "no-such-model" });
  await until(() => s.read().filter((m) => m.type === "error").length === 2);

  await createAgent(s, "a1");
  await createAgent(s, "a1");
  const lists = s.read().filter((m) => m.type === "agent.listed");
  expect((lists.at(-1)!.body as { agents: unknown[] }).agents).toHaveLength(1);
  expect(existsSync(join(s.home, "agents/a1/workdir"))).toBe(true);
});

test("a message gets the Agent's answer as signed events, and sync gives them back to the starter only", async () => {
  const s = await setup();
  await createAgent(s, "a1");
  s.send("task.message", { agent: "a1", id: "msg-1", text: "hello" }, { task: "t1" });
  await s.waitFor("task.event", "m_1", (m) => m.body.kind === "turn.ended");
  const events = s.read().filter((m) => m.type === "task.event").map((m) => (m.body as { kind: string }).kind);
  expect(events).toEqual(["member.message", "turn.started", "llm.message", "turn.ended"]);
  expect(s.provider.requests.at(-1)!.body).toMatchObject({ model: "model-a", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] });

  s.send("task.sync", { agent: "a1", after: 1 }, { task: "t1" });
  const page = await s.waitFor("task.events");
  expect(page.body.events.map((e) => e.seq)).toEqual([2, 3, 4]);

  s.send("task.sync", { agent: "a1", after: 0 }, { seed: secondOwnerSeed, member: "m_2", task: "t1" });
  expect((await s.waitFor("error", "m_2")).body.code).toBe("task.not_found");
});

test("a message to an Agent this Machine does not have says so", async () => {
  const s = await setup();
  s.send("task.message", { agent: "ghost", id: "m", text: "hi" }, { task: "t1" });
  expect((await s.waitFor("error")).body).toMatchObject({ code: "agent.unknown" });
});

test("one worker dying leaves the others answering, and it comes back by itself", async () => {
  const s = await setup();
  await createAgent(s, "a1");
  await createAgent(s, "a2");
  await until(() => !!s.running.workers.pid("a1") && !!s.running.workers.pid("a2"));
  const pid = s.running.workers.pid("a1")!;
  process.kill(pid, "SIGKILL");
  await until(() => s.running.workers.pid("a1") !== pid);

  await talk(s, "a2", "t2", "still there?");
  await until(() => s.running.workers.pid("a1") !== undefined, 8000);
  await talk(s, "a1", "t1", "back?");
}, 20_000);

test("a restarted supervisor starts every Agent's worker again, and drops an envelope sent again", async () => {
  const first = await setup();
  await createAgent(first, "a1");
  first.send("task.message", { agent: "a1", id: "once", text: "hello" }, { task: "t1" });
  await first.waitFor("task.event", "m_1", (m) => m.body.kind === "turn.ended");
  const replay = createSigner(ownerSeed, () => 1)({ type: "agent.list", to: "machine-1", member: "m_1", body: {} });
  cleanup.splice(0).forEach((f) => f());

  const second = await setup(first.home, first.provider);
  await until(() => !!second.running.workers.pid("a1"));
  second.hub.send(replay);
  await until(() => second.lines.includes("dropped an envelope: replayed"));
  second.send("task.sync", { agent: "a1", after: 0 }, { task: "t1" });
  expect((await second.waitFor("task.events")).body.events).toHaveLength(4);
  rmSync(first.home, { recursive: true, force: true });
}, 20_000);

const egressFile = (home: string) => (existsSync(join(home, "runtime/egress.json")) ? JSON.parse(readFileSync(join(home, "runtime/egress.json"), "utf8")) : undefined);

test("the owner sets the Machine's Egress, which the sandbox gets at once, and the same list sent again changes nothing", async () => {
  const s = await setup();
  await createAgent(s, "a1");
  for (let i = 0; i < 2; i++) {
    s.send("egress.set", { egress: ["github.com", "*.npmjs.org", "github.com"] });
    const listed = await s.waitFor("agent.listed", "m_1", (m) => m.body.egress?.includes("github.com") === true);
    expect(listed.body.egress).toEqual(["github.com", "*.npmjs.org"]);
    expect(listed.body.agents.map((a) => a.id)).toEqual(["a1"]);
    s.read().length = 0;
  }
  expect(egressFile(s.home)).toEqual(["github.com", "*.npmjs.org"]);
  expect(egressGiven.at(-1)).toEqual(["github.com", "*.npmjs.org"]);

  s.send("egress.set", { egress: [] });
  await s.waitFor("agent.listed", "m_1", (m) => m.body.egress?.length === 0);
  expect(egressGiven.at(-1)).toEqual([]);
});

test("an Egress with one entry that is not a domain is refused whole, and the old one stays", async () => {
  const s = await setup();
  s.send("egress.set", { egress: ["github.com"] });
  await s.waitFor("agent.listed", "m_1", (m) => m.body.egress?.length === 1);
  const given = egressGiven.length;
  for (const bad of ["https://pypi.org/simple", "10.0.0.1", "localhost"]) {
    s.send("egress.set", { egress: ["pypi.org", bad] });
    await until(() => s.read().filter((m) => m.type === "error").length > 0);
    expect(s.read().find((m) => m.type === "error")!.body).toMatchObject({ code: "egress.invalid_domain" });
    s.read().length = 0;
  }
  expect(egressFile(s.home)).toEqual(["github.com"]);
  expect(egressGiven.length).toBe(given);
});

test("an Egress signed by a key not in trust, or whose signature does not hold, is dropped without an answer", async () => {
  const s = await setup();
  s.send("egress.set", { egress: ["evil.example.com"] }, { seed: strangerSeed });
  const signed = createSigner(ownerSeed, () => seq++)({ type: "egress.set", to: "machine-1", member: "m_1", body: { egress: ["github.com"] } });
  s.hub.send({ ...signed, signed: signed.signed.replace("github.com", "evil.example.com") });
  await until(() => s.lines.includes("dropped an envelope: untrusted-key") && s.lines.includes("dropped an envelope: bad-signature"));
  await Bun.sleep(100);
  expect(s.read()).toEqual([]);
  expect(egressFile(s.home)).toBeUndefined();
});

test("a Machine paired again after unpair starts with no Egress", async () => {
  const first = await setup();
  first.send("egress.set", { egress: ["github.com"] });
  await first.waitFor("agent.listed", "m_1", (m) => m.body.egress?.length === 1);
  cleanup.splice(0).forEach((f) => f());
  expect(await runUnpair({ home: first.home, confirm: async () => true, log: () => {} })).toBe(true);

  const second = await setup(first.home);
  second.send("agent.list", {});
  expect((await second.waitFor("agent.listed")).body.egress).toEqual([]);
  expect(egressGiven.at(-1)).toEqual([]);
  rmSync(first.home, { recursive: true, force: true });
});
