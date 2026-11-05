import { Database as Sqlite } from "bun:sqlite";
import { afterEach, expect, mock, test } from "bun:test";
import { createBackoff, createSigner, fromBase64url, handshakeBytes, publicKeyOf, toBase64url, verifySignature, type Envelope } from "@veeloe/protocol";
import type { Machine } from "../../../entities/machine";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { startHubClient } from "../../../shared/hub-client";

// The entities' public API also brings their React hooks and expo-sqlite, which Bun cannot load.
// Their models are plain code, so the test reads those.
mock.module("../../../entities/agent", () => import("../../../entities/agent/model/agents"));
mock.module("../../../entities/task", () => import("../../../entities/task/model/tasks"));
mock.module("../../../entities/machine", () => import("../../../entities/machine/model/machines"));
const { egressOf, saveMachine } = await import("../../../entities/machine/model/machines");
const { createMachineLinks } = await import("./links");

// TEST-ONLY KEYS.
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineSeed = new Uint8Array(32).fill(0x33);
const strangerSeed = new Uint8Array(32).fill(0x22);
const member = "m_1";

function connection(sqlite: Sqlite): Connection {
  return {
    execAsync: async (sql: string) => void sqlite.exec(sql),
    runAsync: async (sql: string, params: unknown) => sqlite.prepare(sql).run(...(params as [])),
    getAllAsync: async (sql: string, params: unknown) => sqlite.prepare(sql).all(...(params as [])),
    getFirstAsync: async (sql: string) => sqlite.prepare(sql).get(),
    withTransactionAsync: async (work: () => Promise<void>) => {
      sqlite.exec("BEGIN");
      try {
        await work();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => sqlite.close(),
  } as unknown as Connection;
}

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

/** A Hub that lets the Controller in, records what it sends, and can drop it. */
function fakeHub() {
  const hub = { frames: [] as Envelope[], sockets: [] as { send(s: string): void; close(): void }[], connections: 0, url: "" };
  const server = Bun.serve<{ nonce: string; authed?: boolean }>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, s) => (s.upgrade(req, { data: { nonce: toBase64url(crypto.getRandomValues(new Uint8Array(32))) } }) ? undefined : new Response("no", { status: 400 })),
    websocket: {
      open(ws) {
        hub.connections++;
        ws.send(JSON.stringify({ type: "hub.challenge", v: 1, nonce: ws.data.nonce }));
      },
      message(ws, raw) {
        const frame = JSON.parse(String(raw));
        if (ws.data.authed) return void hub.frames.push(frame);
        if (!verifySignature(fromBase64url(frame.sig), handshakeBytes(hub.url, ws.data.nonce), fromBase64url(frame.key))) return ws.close(4401, "no");
        ws.data.authed = true;
        hub.sockets.push(ws);
        ws.send(JSON.stringify({ type: "hub.ready", member }));
      },
    },
  });
  hub.url = `ws://127.0.0.1:${server.port}`;
  cleanup.push(() => server.stop(true));
  return { ...hub, hub, push: (frame: unknown) => hub.sockets.at(-1)!.send(JSON.stringify(frame)), drop: () => hub.sockets.at(-1)!.close() };
}

async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

async function setup() {
  const c = connection(new Sqlite(":memory:"));
  await migrate(c, MIGRATIONS);
  const database = createDatabase(c);
  const fake = fakeHub();
  const machine: Machine = { id: "machine-1", public_key: toBase64url(publicKeyOf(machineSeed)), name: "mac", hub_url: fake.hub.url, workspace_id: "w", member_id: member, paired_at: 1, egress: "[]" };
  await saveMachine(database, machine);
  let n = 0;
  const links = createMachineLinks({ database, secretKey: controllerSeed, newId: () => `id-${++n}`, start: (o) => startHubClient({ ...o, backoff: createBackoff({ baseMs: 10, capMs: 20 }) }) });
  cleanup.push(() => links.stop());
  links.update([machine]);
  await until(() => fake.hub.frames.length > 0);
  return { database, fake, machine, links };
}

const signed = (type: string, body: unknown, { seed = machineSeed, seq = 1, task }: { seed?: Uint8Array; seq?: number; task?: string } = {}) => createSigner(seed, () => seq)({ type, recipients: [member], ...(task ? { task } : {}), body });
const sentTypes = (frames: Envelope[]) => frames.map((f) => JSON.parse(f.signed) as { type: string; task?: string; member?: string; to?: string; body: { after?: number } });

test("on connect it asks the Machine for its Agents, as this Member", async () => {
  const { fake } = await setup();
  expect(sentTypes(fake.hub.frames)).toEqual([expect.objectContaining({ type: "agent.list", to: "machine-1", member })]);
});

test("what the Machine signed is kept, and the same thing from another key is not", async () => {
  const { database, fake, links } = await setup();
  const agents = [{ id: "a1", name: "Deployer", provider: "main", model: "model-a" }];
  fake.push(signed("agent.listed", { agents: [{ ...agents[0], name: "Forged" }], providers: [] }, { seed: strangerSeed }));
  fake.push(signed("agent.listed", { agents, providers: [{ name: "main", models: [{ id: "model-a" }] }] }));
  await until(async () => (await database.query("SELECT * FROM agent")).length === 1);
  await Bun.sleep(50);
  expect(await database.query("SELECT name FROM agent")).toEqual([{ name: "Deployer" }]);
  expect(links.status("machine-1")).toMatchObject({ online: true, providers: [{ name: "main" }] });
});

test("a new Agent goes with the Character the page picked, and the one the Machine keeps lands in the agent table", async () => {
  const { database, fake, machine, links } = await setup();
  const character = { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "ears", decal: "none" };
  expect(links.createAgent(machine, { name: "A", provider: "main", model: "model-a", character })).toBe("id-1");
  await until(() => fake.hub.frames.length === 2);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "agent.create", body: { id: "id-1", name: "A", character } });
  fake.push(signed("agent.listed", { agents: [{ id: "id-1", name: "A", provider: "main", model: "model-a", character }, { id: "old", name: "B", provider: "main", model: "model-a" }], providers: [] }));
  await until(async () => (await database.query("SELECT * FROM agent")).length === 2);
  const rows = await database.query<{ id: string; character: string | null }>("SELECT id, character FROM agent ORDER BY id");
  expect(rows.map((r) => [r.id, r.character && JSON.parse(r.character)])).toEqual([
    ["id-1", character],
    ["old", null],
  ]);
});

test("after a dropped connection it asks for each Task's events after the last one kept", async () => {
  const { database, fake } = await setup();
  fake.push(signed("task.event", { agent: "a1", seq: 1, kind: "member.message", at: 1, body: {} }, { seq: 2, task: "t1" }));
  fake.push(signed("task.event", { agent: "a1", seq: 2, kind: "turn.started", at: 2, body: {} }, { seq: 3, task: "t1" }));
  await until(async () => (await database.query("SELECT * FROM task_event")).length === 2);
  fake.hub.frames.length = 0;
  fake.drop();
  await until(() => fake.hub.frames.some((f) => JSON.parse(f.signed).type === "task.sync"));
  expect(sentTypes(fake.hub.frames).find((m) => m.type === "task.sync")).toMatchObject({ task: "t1", body: { agent: "a1", after: 2 } });
});

test("a message shows as pending until the log has it, and the Machine's error marks it failed", async () => {
  const { database, fake, machine, links } = await setup();
  await links.sendMessage(machine, { agent: "a1", task: "t1", text: "hello" });
  await until(() => fake.hub.frames.length === 2);
  const sent = fake.hub.frames.at(-1)!;
  expect(JSON.parse(sent.signed)).toMatchObject({ type: "task.message", task: "t1", body: { agent: "a1", id: "id-1", text: "hello" } });
  fake.push(signed("error", { code: "agent.busy", ref: sent.sig }, { seq: 5 }));
  await until(async () => (await database.query<{ error: string }>("SELECT error FROM pending_message"))[0]?.error === "agent.busy");
});

test("stopping closes the connection and nothing more goes out", async () => {
  const { fake, links, machine } = await setup();
  links.stop();
  expect(links.createAgent(machine, { name: "A", provider: "main", model: "model-a" })).toBeNull();
  await Bun.sleep(100);
  expect(fake.hub.connections).toBe(1);
});

test("a Machine that was offline is asked again until it answers", async () => {
  const { fake, links } = await setup();
  const first = fake.hub.frames[0]!;
  fake.push({ type: "hub.error", code: "hub.machine_offline", ref: first.sig });
  await until(() => links.status("machine-1").online === false);
  await until(() => fake.hub.frames.filter((f) => JSON.parse(f.signed).type === "agent.list").length === 2, 6000);
  fake.push(signed("agent.listed", { agents: [], providers: [] }));
  await until(() => links.status("machine-1").online === true);
}, 10_000);

test("the Egress goes as one signed list, and the list kept is the one the Machine signed back", async () => {
  const { database, fake, machine, links } = await setup();
  expect(links.setEgress(machine, ["github.com", "*.npmjs.org"])).toBe(true);
  await until(() => fake.hub.frames.length === 2);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "egress.set", to: "machine-1", member, body: { egress: ["github.com", "*.npmjs.org"] } });

  fake.push(signed("agent.listed", { agents: [], providers: [], egress: ["evil.example.com"] }, { seed: strangerSeed }));
  fake.push(signed("agent.listed", { agents: [], providers: [], egress: ["github.com", "*.npmjs.org"] }));
  await until(async () => egressOf((await database.query<Machine>("SELECT * FROM machine"))[0]!).length === 2);
  // A Machine that says nothing of an Egress leaves the one kept as it was.
  fake.push(signed("agent.listed", { agents: [], providers: [] }, { seq: 2 }));
  await Bun.sleep(50);
  expect(egressOf((await database.query<Machine>("SELECT * FROM machine"))[0]!)).toEqual(["github.com", "*.npmjs.org"]);
});
