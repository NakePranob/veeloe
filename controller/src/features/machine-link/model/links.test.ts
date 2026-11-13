import { Database as Sqlite } from "bun:sqlite";
import { afterEach, expect, mock, test } from "bun:test";
import { createBackoff, createSigner, fromBase64url, handshakeBytes, hashBytes, publicKeyOf, signCertificate, toBase64url, verifySignature, type Envelope } from "@veeloe/protocol-ts";
import type { Machine } from "../../../entities/machine";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { startHubClient } from "../../../shared/hub-client";

// The entities' public API also brings their React hooks and expo-sqlite, which Bun cannot load.
// Their models are plain code, so the test reads those.
mock.module("../../../entities/agent", () => import("../../../entities/agent/model/agents"));
mock.module("../../../entities/task", () => import("../../../entities/task/model/tasks"));
mock.module("../../../entities/machine", () => import("../../../entities/machine/model/machines"));
mock.module("../../../entities/device", () => import("../../../entities/device/model/devices"));
mock.module("../../../entities/usage", () => import("../../../entities/usage/model/usage"));
class FakeFile {
  static last: FakeFile | null = null;
  static previews = 0;
  exists = false;
  parentDirectory = { create() {} };
  bytes: Uint8Array | null = null;
  private parts: unknown[];
  constructor(..._parts: unknown[]) {
    this.parts = _parts;
    FakeFile.last = this;
  }
  get name() {
    const last = this.parts.at(-1);
    return typeof last === "string" ? last.split("/").at(-1)! : "file";
  }
  get type() {
    return "text/plain";
  }
  write = async (content: Uint8Array) => {
    this.bytes = content;
  };
  static canPreview = async () => true;
  static preview = async () => {
    FakeFile.previews++;
  };
}
mock.module("expo-file-system", () => ({
  Paths: { cache: "file:///cache/" },
  Directory: class {},
  File: FakeFile,
}));
mock.module("react-native", () => ({ Linking: { openURL: async () => {} } }));
console.log("links.test: importing the machine model");
const { egressOf, saveMachine } = await import("../../../entities/machine/model/machines");
console.log("links.test: importing links");
const { createMachineLinks } = await import("./links");
console.log("links.test: ready");

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
  const hub = { frames: [] as Envelope[], sockets: [] as { send(s: string): void; close(code?: number): void }[], connections: 0, url: "" };
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
  return { ...hub, hub, push: (frame: unknown) => hub.sockets.at(-1)!.send(JSON.stringify(frame)), drop: () => hub.sockets.at(-1)!.close(), revoke: () => hub.sockets.at(-1)!.close(4403) };
}

async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

async function setup(extra: { onRevoked?: () => void; deviceName?: string } = {}) {
  const c = connection(new Sqlite(":memory:"));
  await migrate(c, MIGRATIONS);
  const database = createDatabase(c);
  const fake = fakeHub();
  const machine: Machine = { id: "machine-1", public_key: toBase64url(publicKeyOf(machineSeed)), name: "mac", hub_url: fake.hub.url, workspace_id: "w", member_id: member, paired_at: 1, egress: "[]" };
  await saveMachine(database, machine);
  let n = 0;
  const links = createMachineLinks({ database, secretKey: controllerSeed, newId: () => `id-${++n}`, ...extra, start: (o) => startHubClient({ ...o, backoff: createBackoff({ baseMs: 10, capMs: 20 }) }) });
  cleanup.push(() => links.stop());
  links.update([machine]);
  await until(() => fake.hub.frames.length === 2);
  return { database, fake, machine, links };
}

const signed = (type: string, body: unknown, { seed = machineSeed, seq = 1, task }: { seed?: Uint8Array; seq?: number; task?: string } = {}) => createSigner(seed, () => seq)({ type, recipients: [member], ...(task ? { task } : {}), body });
const sentTypes = (frames: Envelope[]) => frames.map((f) => JSON.parse(f.signed) as { type: string; task?: string; member?: string; to?: string; body: { after?: number } });

test("on connect it asks the Machine for its Agents and this Member's Tasks, as this Member", async () => {
  const { fake } = await setup();
  expect(sentTypes(fake.hub.frames)).toEqual([expect.objectContaining({ type: "agent.list", to: "machine-1", member }), expect.objectContaining({ type: "task.list", to: "machine-1", member })]);
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
  await until(() => fake.hub.frames.length === 3);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "agent.create", body: { id: "id-1", name: "A", character } });
  fake.push(signed("agent.listed", { agents: [{ id: "id-1", name: "A", provider: "main", model: "model-a", character }, { id: "old", name: "B", provider: "main", model: "model-a" }], providers: [] }));
  await until(async () => (await database.query("SELECT * FROM agent")).length === 2);
  const rows = await database.query<{ id: string; character: string | null }>("SELECT id, character FROM agent ORDER BY id");
  expect(rows.map((r) => [r.id, r.character && JSON.parse(r.character)])).toEqual([
    ["id-1", character],
    ["old", null],
  ]);
});

test("a change to an Agent goes signed with only its fields, and the Machine's error about that envelope is kept as its updateError", async () => {
  const { fake, machine, links } = await setup();
  const sig = links.updateAgent(machine, { id: "a1", model: "model-b" });
  await until(() => fake.hub.frames.length === 3);
  const sent = fake.hub.frames.at(-1)!;
  expect(sent.sig).toBe(sig!);
  expect(JSON.parse(sent.signed)).toMatchObject({ type: "agent.update", to: "machine-1", member, body: { id: "a1", model: "model-b" } });
  // An error about another envelope is not this one's.
  fake.push(signed("error", { code: "agent.busy", ref: "someone-else" }, { seq: 4 }));
  fake.push(signed("error", { code: "agent.provider_unknown", ref: sent.sig }, { seq: 5 }));
  await until(() => links.status("machine-1").updateError === "agent.provider_unknown");
  expect(links.status("machine-1").createError).toBeNull();

  links.updateAgent(machine, { id: "a1", name: "B" });
  expect(links.status("machine-1").updateError).toBeNull();
  await until(() => fake.hub.frames.length === 4);
  fake.push({ type: "hub.error", code: "hub.machine_offline", ref: fake.hub.frames.at(-1)!.sig });
  await until(() => links.status("machine-1").updateError === "hub.machine_offline");
  expect(links.status("machine-1").online).toBe(false);

  links.stop();
  expect(links.updateAgent(machine, { id: "a1", name: "C" })).toBeNull();
});

test("deleting an Agent goes signed as agent.delete and its error is kept separately", async () => {
  const { fake, links, machine } = await setup();
  const sig = links.deleteAgent(machine, "a1");
  await until(() => fake.hub.frames.length === 3);
  const sent = fake.hub.frames.at(-1)!;
  expect(sent.sig).toBe(sig!);
  expect(JSON.parse(sent.signed)).toMatchObject({ type: "agent.delete", to: "machine-1", member, body: { id: "a1" } });
  fake.push(signed("error", { code: "agent.unknown", ref: sent.sig }, { seq: 4 }));
  await until(() => links.status("machine-1").deleteError === "agent.unknown");
  expect(links.status("machine-1").updateError).toBeNull();
});

test("restoring an Agent goes signed as agent.restore and its error is kept separately", async () => {
  const { fake, links, machine } = await setup();
  const sig = links.restoreAgent(machine, "a1");
  await until(() => fake.hub.frames.length === 3);
  const sent = fake.hub.frames.at(-1)!;
  expect(sent.sig).toBe(sig!);
  expect(JSON.parse(sent.signed)).toMatchObject({ type: "agent.restore", to: "machine-1", member, body: { id: "a1" } });
  fake.push(signed("error", { code: "agent.unknown", ref: sent.sig }, { seq: 4 }));
  await until(() => links.status("machine-1").restoreError === "agent.unknown");
  expect(links.status("machine-1").deleteError).toBeNull();
});

test("an answer with a trash keeps deleted Agents here, and one without it clears the trash", async () => {
  const { database, fake } = await setup();
  const trash = [{ id: "a1", name: "Gone", provider: "main", model: "model-a", deletedAt: 1, restoreUntil: 2 }];
  fake.push(signed("agent.listed", { agents: [], trash, providers: [] }));
  await until(async () => (await database.query("SELECT * FROM agent_trash")).length === 1);
  expect(await database.query("SELECT id, name FROM agent_trash")).toEqual([{ id: "a1", name: "Gone" }]);

  // A Machine older than agent-trash says nothing of a trash, and has none.
  fake.push(signed("agent.listed", { agents: [{ id: "a1", name: "Gone", provider: "main", model: "model-a" }], providers: [] }, { seq: 2 }));
  await until(async () => (await database.query("SELECT * FROM agent")).length === 1);
  expect(await database.query("SELECT * FROM agent_trash")).toEqual([]);
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
  await until(() => fake.hub.frames.length === 3);
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
  await until(() => fake.hub.frames.length === 3);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "egress.set", to: "machine-1", member, body: { egress: ["github.com", "*.npmjs.org"] } });

  fake.push(signed("agent.listed", { agents: [], providers: [], egress: ["evil.example.com"] }, { seed: strangerSeed }));
  fake.push(signed("agent.listed", { agents: [], providers: [], egress: ["github.com", "*.npmjs.org"] }));
  await until(async () => egressOf((await database.query<Machine>("SELECT * FROM machine"))[0]!).length === 2);
  // A Machine that says nothing of an Egress leaves the one kept as it was.
  fake.push(signed("agent.listed", { agents: [], providers: [] }, { seq: 2 }));
  await Bun.sleep(50);
  expect(egressOf((await database.query<Machine>("SELECT * FROM machine"))[0]!)).toEqual(["github.com", "*.npmjs.org"]);
});

const newSeed = new Uint8Array(32).fill(0x55);
const ipadSeed = new Uint8Array(32).fill(0x56);
const keyOf = (seed: Uint8Array) => toBase64url(publicKeyOf(seed));
const devices = (database: Awaited<ReturnType<typeof setup>>["database"]) =>
  database.query<{ key: string; name: string; linked_by: string | null; revoked_at: number | null }>("SELECT key, name, linked_by, revoked_at FROM device ORDER BY coalesce(linked_at, 0), key");

test("the device list comes from certificates that check out: this one first, who linked whom, what was revoked", async () => {
  const { database, fake, links } = await setup({ deviceName: "iPhone" });
  const heard: string[] = [];
  links.onLinked((news) => heard.push(...news.map((n) => n.name)));
  const at = Date.now();
  const link = signCertificate({ type: "device.link", workspace: "w", member, key: keyOf(newSeed), name: "Chrome", at }, controllerSeed);
  const forged = { ...signCertificate({ type: "device.link", workspace: "w", member, key: keyOf(strangerSeed), name: "Evil", at }, controllerSeed), sig: link.sig };
  const fromNew = signCertificate({ type: "device.link", workspace: "w", member, key: keyOf(ipadSeed), name: "iPad", at: at + 1 }, newSeed);
  fake.push({ type: "hub.certificates", certificates: [link, forged, fromNew] });
  await until(async () => (await devices(database)).length === 3);
  expect(await devices(database)).toEqual([
    { key: keyOf(controllerSeed), name: "iPhone", linked_by: null, revoked_at: null },
    { key: keyOf(newSeed), name: "Chrome", linked_by: keyOf(controllerSeed), revoked_at: null },
    { key: keyOf(ipadSeed), name: "iPad", linked_by: keyOf(newSeed), revoked_at: null },
  ]);
  // Only the link another device made is news; this device's own is not.
  expect(heard).toEqual(["iPad"]);

  // Revoking the browser takes the iPad it linked, since nothing was kept.
  fake.push({ type: "hub.certificates", certificates: [signCertificate({ type: "device.revoke", workspace: "w", member, key: keyOf(newSeed), keep: [], at: at + 2 }, controllerSeed)] });
  await until(async () => (await devices(database)).every((d) => d.key === keyOf(controllerSeed) || d.revoked_at !== null));
});

test("Tasks the Machine lists are added and synced from the start, without touching one already here", async () => {
  const { database, fake } = await setup();
  fake.push(signed("task.event", { agent: "a1", seq: 1, kind: "member.message", at: 1, body: {} }, { seq: 2, task: "known" }));
  await until(async () => (await database.query("SELECT * FROM task")).length === 1);
  fake.hub.frames.length = 0;
  fake.push(signed("task.listed", { tasks: [{ id: "known", agent: "a1", updated: 99 }, { id: "new", agent: "a2", updated: 50 }] }, { seq: 3 }));
  await until(() => fake.hub.frames.length === 1);
  expect(sentTypes(fake.hub.frames)).toEqual([expect.objectContaining({ type: "task.sync", task: "new", body: { agent: "a2", after: 0 } })]);
  expect(await database.query("SELECT id, synced_seq, updated_at FROM task ORDER BY id")).toEqual([
    { id: "known", synced_seq: 1, updated_at: 1 },
    { id: "new", synced_seq: 0, updated_at: 50 },
  ]);
});

test("a 4403 from the Hub says this key was revoked, and the client stops trying", async () => {
  let revoked = 0;
  const { fake } = await setup({ onRevoked: () => revoked++ });
  fake.revoke();
  await until(() => revoked === 1);
  await Bun.sleep(100);
  expect(fake.hub.connections).toBe(1);
});

test("agent.usage keeps today's tally, and a later listed answer that is older does not take it back", async () => {
  const { database, fake } = await setup();
  const agents = [{ id: "a1", name: "A", provider: "main", model: "model-a" }];
  fake.push(signed("agent.listed", { agents, providers: [] }));
  await until(async () => (await database.query("SELECT * FROM agent")).length === 1);

  fake.push(signed("agent.usage", { agent: "a1", day: "2026-11-06", tokens: 3_000_000, budget: 10_000_000 }, { seq: 2 }));
  await until(async () => (await database.query<{ usage_tokens: number }>("SELECT usage_tokens FROM agent"))[0]?.usage_tokens === 3_000_000);

  // `agent.listed` arriving after the newer `agent.usage`, with the same day but fewer tokens.
  fake.push(signed("agent.listed", { agents: [{ ...agents[0], budget: 10_000_000, usage: { day: "2026-11-06", tokens: 2_000_000 } }], providers: [] }, { seq: 3 }));
  await Bun.sleep(50);
  expect(await database.query("SELECT usage_day, usage_tokens FROM agent")).toEqual([{ usage_day: "2026-11-06", usage_tokens: 3_000_000 }]);
});

test("a usage request goes signed with its request id and days, and the Machine's answer is cached before the page hears of it", async () => {
  const { database, fake, machine, links } = await setup();
  const request = links.requestUsage(machine, 7);
  expect(request).not.toBeNull();
  expect(links.usage("machine-1")).toMatchObject({ request, days: 7, loading: true, error: null });
  await until(() => fake.hub.frames.length === 3);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "usage.list", to: "machine-1", member, body: { request, days: 7 } });

  fake.push(signed("usage.listed", { request, from: "2026-10-31", to: "2026-11-06", agents: [{ agent: "a1", days: [{ day: "2026-11-06", tokens: 100 }], tasks: [{ task: "t1", tokens: 100 }], sources: [{ source: "task", tokens: 100 }] }] }));
  await until(async () => (await database.query("SELECT * FROM usage_day")).length === 1);
  await until(() => links.usage("machine-1").loading === false);
  expect(await database.query("SELECT agent_id, day, tokens FROM usage_day")).toEqual([{ agent_id: "a1", day: "2026-11-06", tokens: 100 }]);
  expect((await database.query<{ usage_fetched_at: number }>("SELECT usage_fetched_at FROM machine"))[0]!.usage_fetched_at).toBeGreaterThan(0);
});

test("an answer to an older request is dropped whole and does not clear the page's loading state", async () => {
  const { database, fake, machine, links } = await setup();
  const request = links.requestUsage(machine, 7)!;
  await until(() => fake.hub.frames.length === 3);
  fake.push(signed("usage.listed", { request: "an-older-one", from: "2026-10-31", to: "2026-11-05", agents: [{ agent: "a1", days: [{ day: "2026-11-05", tokens: 10 }], tasks: [], sources: [] }] }, { seq: 1 }));
  await Bun.sleep(100);
  expect(await database.query("SELECT * FROM usage_day")).toEqual([]);
  expect(links.usage("machine-1").loading).toBe(true);

  fake.push(signed("usage.listed", { request, from: "2026-10-31", to: "2026-11-06", agents: [{ agent: "a1", days: [{ day: "2026-11-06", tokens: 20 }], tasks: [], sources: [] }] }, { seq: 2 }));
  await until(async () => (await database.query("SELECT * FROM usage_day")).length === 1);
  await until(() => links.usage("machine-1").loading === false);
  expect(links.usage("machine-1").error).toBeNull();
});

test("a Machine's error about a usage request fails that request only, and does not mark a chat message as failed", async () => {
  const { database, fake, machine, links } = await setup();
  links.requestUsage(machine, 7);
  await until(() => fake.hub.frames.length === 3);
  fake.push(signed("error", { code: "usage.invalid_range", ref: fake.hub.frames.at(-1)!.sig }));
  await until(() => links.usage("machine-1").error === "usage.invalid_range");
  expect(links.usage("machine-1").loading).toBe(false);
  expect(await database.query("SELECT * FROM pending_message")).toEqual([]);
});

test("a Hub that says the Machine is offline fails this request only, and does not mark a message as failed", async () => {
  const { database, fake, machine, links } = await setup();
  links.requestUsage(machine, 7);
  await until(() => fake.hub.frames.length === 3);
  fake.push({ type: "hub.error", code: "hub.machine_offline", ref: fake.hub.frames.at(-1)!.sig });
  await until(() => links.usage("machine-1").error === "hub.machine_offline");
  expect(links.usage("machine-1").loading).toBe(false);
  expect(await database.query("SELECT * FROM pending_message")).toEqual([]);
});

test("opening an offered file asks the Machine, decodes every chunk, keeps the bytes and hands the file to the OS", async () => {
  const { fake, machine, links } = await setup();
  const bytes = new Uint8Array(256 * 1024 + 7).map((_, index) => index % 256);
  const hash = hashBytes(bytes);
  const opening = links.openFile(machine, "task-1", "a1", "/workdir/report.txt", hash, "report.txt");
  await until(() => fake.hub.frames.some((frame) => JSON.parse(frame.signed).type === "file.get"));
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "file.get", task: "task-1", body: { agent: "a1", path: "/workdir/report.txt", hash } });

  fake.push(signed("file.chunk", { file: hash, name: "report.txt", index: 0, total: 2, data: toBase64url(bytes.slice(0, 256 * 1024)) }, { task: "task-1", seq: 1 }));
  fake.push(signed("file.chunk", { file: hash, name: "report.txt", index: 1, total: 2, data: toBase64url(bytes.slice(256 * 1024)) }, { task: "task-1", seq: 2 }));
  await opening;

  expect(FakeFile.last!.bytes).toEqual(bytes);
  expect(FakeFile.previews).toBe(1);
});

test("a hash that is not a SHA-256 is refused before it can name a cache folder", async () => {
  const { fake, machine, links } = await setup();
  await expect(links.openFile(machine, "task-1", "a1", "/workdir/report.txt", "../../etc/passwd", "report.txt")).rejects.toThrow("attachment.invalid");
  expect(fake.hub.frames.some((frame) => JSON.parse(frame.signed).type === "file.get")).toBe(false);
});

test("bytes that do not match the offered hash are not written or opened", async () => {
  const { fake, machine, links } = await setup();
  const expected = hashBytes(new Uint8Array([1, 2, 3]));
  FakeFile.last = null;
  FakeFile.previews = 0;
  const opening = links.openFile(machine, "task-1", "a1", "/workdir/report.txt", expected, "report.txt");
  await until(() => fake.hub.frames.some((frame) => JSON.parse(frame.signed).type === "file.get"));
  fake.push(signed("file.chunk", { file: expected, name: "report.txt", index: 0, total: 1, data: toBase64url(new Uint8Array([9, 9, 9])) }, { task: "task-1" }));
  await expect(opening).rejects.toThrow("attachment.invalid");
  expect((FakeFile.last as FakeFile | null)?.bytes ?? null).toBeNull();
  expect(FakeFile.previews).toBe(0);
});

test("a push token goes to the Machine with the language, and unregister clears this device only", async () => {
  const { fake, machine, links } = await setup();
  expect(links.registerPush(machine, "ExponentPushToken[abc]", "th")).not.toBeNull();
  await until(() => fake.hub.frames.length === 3);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({
    type: "push.register",
    body: { token: "ExponentPushToken[abc]", language: "th" },
  });
  expect(links.unregisterPush(machine)).not.toBeNull();
  await until(() => fake.hub.frames.length === 4);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({ type: "push.unregister", body: {} });
});

test("a memory request goes signed with its request id, and the answer keeps the whole-file count", async () => {
  const { fake, machine, links } = await setup();
  const request = links.requestMemory(machine, "a1");
  expect(request).not.toBeNull();
  expect(links.memory("machine-1", "a1")).toMatchObject({ machine: "machine-1", agent: "a1", request, loading: true, error: null, memory: null });
  await until(() => fake.hub.frames.length === 3);
  expect(JSON.parse(fake.hub.frames.at(-1)!.signed)).toMatchObject({
    type: "memory.get",
    to: "machine-1",
    member,
    body: { request, agent: "a1" },
  });

  fake.push(signed("memory.got", { request, agent: "a1", exists: true, chars: 4_010, text: "a".repeat(4_000) }));
  await until(() => links.memory("machine-1", "a1").loading === false);
  const status = links.memory("machine-1", "a1");
  expect(status.error).toBeNull();
  expect(status.memory).toEqual({ exists: true, chars: 4_010, text: "a".repeat(4_000) });
  expect(status.fetchedAt).toBeGreaterThan(0);
});

test("a memory answer for an older request or another Agent is dropped whole", async () => {
  const { fake, machine, links } = await setup();
  const request = links.requestMemory(machine, "a1")!;
  await until(() => fake.hub.frames.length === 3);

  fake.push(signed("memory.got", { request: "an-older-one", agent: "a1", exists: true, chars: 1, text: "x" }, { seq: 1 }));
  fake.push(signed("memory.got", { request, agent: "a2", exists: true, chars: 1, text: "x" }, { seq: 2 }));
  await Bun.sleep(100);
  expect(links.memory("machine-1", "a1")).toMatchObject({ loading: true, memory: null, error: null });
  expect(links.memory("machine-1", "a2")).toMatchObject({ request: null, memory: null });

  fake.push(signed("memory.got", { request, agent: "a1", exists: false, chars: 0, text: "" }, { seq: 3 }));
  await until(() => links.memory("machine-1", "a1").loading === false);
  expect(links.memory("machine-1", "a1").memory).toEqual({ exists: false, chars: 0, text: "" });
});

test("a Machine's error about a memory request fails that request and leaves the page's other state alone", async () => {
  const { fake, machine, links } = await setup();
  links.requestMemory(machine, "a1");
  await until(() => fake.hub.frames.length === 3);
  fake.push(signed("error", { code: "agent.unknown", ref: fake.hub.frames.at(-1)!.sig }));
  await until(() => links.memory("machine-1", "a1").error === "agent.unknown");
  expect(links.memory("machine-1", "a1").loading).toBe(false);
  expect(links.memory("machine-1", "a1").memory).toBeNull();
});
