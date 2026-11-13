import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import type { Agent } from "@veeloe/protocol-ts";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { allowlistOf, approvalTimeoutOf, egressOf, saveAgents, saveUsage } from "./agents";

// Real SQL on bun:sqlite, behind the few methods expo-sqlite gives the app.
function connect(): Connection {
  const sqlite = new Sqlite(":memory:");
  return {
    execAsync: async (sql: string) => void sqlite.exec(sql),
    runAsync: async (sql: string, params: never[]) => sqlite.prepare(sql).run(...params),
    getAllAsync: async (sql: string, params: never[] = []) => sqlite.prepare(sql).all(...params),
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

const character = { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "ears", decal: "none" };
const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a", character };

let database: ReturnType<typeof createDatabase>;
beforeEach(async () => {
  const connection = connect();
  await migrate(connection, MIGRATIONS);
  database = createDatabase(connection);
});

const row = () => database.query("SELECT * FROM agent WHERE id = 'a1'").then((rows) => rows[0] as Record<string, unknown> | undefined);

test("an Agent's Budget and today's tally are kept, and an answer without them does not erase what is kept", async () => {
  await saveAgents(database, "machine-1", [{ ...agent, budget: 5_000_000, usage: { day: "2026-11-06", tokens: 100 } }]);
  expect(await row()).toMatchObject({ budget: 5_000_000, usage_day: "2026-11-06", usage_tokens: 100, character: JSON.stringify(character) });

  // A Machine older than `daily-budget` says nothing of either, and its Character is unchanged.
  await saveAgents(database, "machine-1", [{ id: "a1", name: "Renamed", provider: "main", model: "model-a" }]);
  expect(await row()).toMatchObject({ name: "Renamed", budget: 5_000_000, usage_day: "2026-11-06", usage_tokens: 100, character: JSON.stringify(character) });
});

test("a tally from an older day, or a lower one on the same day, never replaces what is kept", async () => {
  await saveAgents(database, "machine-1", [agent]);

  await saveUsage(database, { agent: "a1", day: "2026-11-06", tokens: 300 });
  expect(await row()).toMatchObject({ usage_day: "2026-11-06", usage_tokens: 300 });

  await saveUsage(database, { agent: "a1", day: "2026-11-06", tokens: 200 });
  await saveUsage(database, { agent: "a1", day: "2026-11-05", tokens: 999 });
  expect(await row()).toMatchObject({ usage_day: "2026-11-06", usage_tokens: 300 });

  await saveUsage(database, { agent: "a1", day: "2026-11-06", tokens: 400 });
  expect(await row()).toMatchObject({ usage_day: "2026-11-06", usage_tokens: 400 });

  await saveUsage(database, { agent: "a1", day: "2026-11-07", tokens: 5 });
  expect(await row()).toMatchObject({ usage_day: "2026-11-07", usage_tokens: 5 });
});

test("a tally for an Agent this Controller has never heard of changes nothing", async () => {
  await saveUsage(database, { agent: "ghost", day: "2026-11-06", tokens: 10 });
  expect(await row()).toBeUndefined();
});

test("an Approval timeout is kept, and an answer without one does not erase what is kept", async () => {
  await saveAgents(database, "machine-1", [{ ...agent, approvalTimeoutS: 300 }]);
  expect(await row()).toMatchObject({ approval_timeout_s: 300 });
  expect(approvalTimeoutOf({ approval_timeout_s: (await row())!.approval_timeout_s as number })).toBe(300);

  await saveAgents(database, "machine-1", [{ id: "a1", name: "Renamed", provider: "main", model: "model-a" }]);
  expect(await row()).toMatchObject({ approval_timeout_s: 300 });
  expect(approvalTimeoutOf({ approval_timeout_s: null })).toBeNull();
});

test("an Allowlist is kept as JSON, and an answer without one does not erase what is kept", async () => {
  await saveAgents(database, "machine-1", [{ ...agent, allowlist: ["ls", "git status"] }]);
  expect(await row()).toMatchObject({ allowlist: JSON.stringify(["ls", "git status"]) });
  expect(allowlistOf({ allowlist: (await row())!.allowlist as string })).toEqual(["ls", "git status"]);

  // A Machine older than `approval-and-allowlist` says nothing of it.
  await saveAgents(database, "machine-1", [{ id: "a1", name: "Renamed", provider: "main", model: "model-a" }]);
  expect(await row()).toMatchObject({ allowlist: JSON.stringify(["ls", "git status"]) });
});

test("allowlistOf reads null as unknown and broken JSON as empty", async () => {
  expect(allowlistOf({ allowlist: null })).toBeNull();
  expect(allowlistOf({ allowlist: "nope{" })).toEqual([]);
  expect(allowlistOf({ allowlist: JSON.stringify([1]) })).toEqual([]);
});

test("each Agent's Egress is kept as its own JSON, and an answer without one does not erase what is kept", async () => {
  const other = { ...agent, id: "a2", name: "B" };
  await saveAgents(database, "machine-1", [
    { ...agent, egress: ["github.com"] },
    { ...other, egress: ["*.npmjs.org"] },
  ]);
  const rows = () => database.query<{ id: string; egress: string }>("SELECT id, egress FROM agent ORDER BY id");
  expect((await rows()).map((row) => [row.id, egressOf(row)])).toEqual([
    ["a1", ["github.com"]],
    ["a2", ["*.npmjs.org"]],
  ]);

  // A Machine older than per-Agent Egress says nothing of it, which leaves both lists as they were.
  await saveAgents(database, "machine-1", [
    { id: "a1", name: "Renamed", provider: "main", model: "model-a" },
    { id: "a2", name: "B", provider: "main", model: "model-a" },
  ]);
  expect((await rows()).map((row) => egressOf(row))).toEqual([["github.com"], ["*.npmjs.org"]]);

  // An Agent added later starts empty, while the one still listed keeps its list.
  await saveAgents(database, "machine-1", [{ id: "a2", name: "B", provider: "main", model: "model-a" }, { ...other, id: "a3", name: "C" }]);
  expect((await rows()).map((row) => [row.id, egressOf(row)])).toEqual([
    ["a2", ["*.npmjs.org"]],
    ["a3", []],
  ]);
});

test("egressOf reads broken JSON as empty and keeps only the domains", () => {
  expect(egressOf({ egress: "nope{" })).toEqual([]);
  expect(egressOf({ egress: JSON.stringify(["github.com", 1]) })).toEqual(["github.com"]);
  expect(egressOf({ egress: "[]" })).toEqual([]);
});

test("a database from before per-Agent Egress upgrades with an empty list, and its Agent stays", async () => {
  const before = MIGRATIONS.findIndex((migration) => migration.includes("ADD COLUMN egress"));
  expect(before).toBeGreaterThan(-1);
  const connection = connect();
  await migrate(connection, MIGRATIONS.slice(0, before));
  await connection.runAsync("INSERT INTO agent (id, machine_id, name, provider, model) VALUES (?, ?, ?, ?, ?)", ["old", "machine-1", "Old", "main", "model-a"] as never[]);
  await migrate(connection, MIGRATIONS);
  const [row] = await connection.getAllAsync<{ id: string; egress: string }>("SELECT id, egress FROM agent");
  expect(row).toEqual({ id: "old", egress: "[]" });
  expect(egressOf(row!)).toEqual([]);
});

test("an Agent the Machine no longer lists is removed here, while another Machine's Agent stays", async () => {
  await saveAgents(database, "machine-1", [agent, { ...agent, id: "a2", name: "B" }]);
  await saveAgents(database, "machine-2", [{ ...agent, id: "a3", name: "C" }]);
  await saveAgents(database, "machine-1", [{ ...agent, id: "a2", name: "B" }]);
  const ids = (await database.query<{ id: string; machine_id: string }>("SELECT id, machine_id FROM agent ORDER BY id")).map((row) => `${row.machine_id}:${row.id}`);
  expect(ids).toEqual(["machine-1:a2", "machine-2:a3"]);
});

const trashRow = (id: string) => database.query<Record<string, unknown>>("SELECT * FROM agent_trash WHERE id = ?", [id]).then((rows) => rows[0]);

test("an Agent the Machine deleted moves to the trash, and a restore moves it back", async () => {
  const entry = { ...agent, deletedAt: 1_800_000_000_000, restoreUntil: 1_802_592_000_000 };
  await saveAgents(database, "machine-1", [agent]);
  // Delete: the Machine no longer lists it as an Agent, only in its trash.
  await saveAgents(database, "machine-1", [], [entry]);
  expect(await row()).toBeUndefined();
  expect(await trashRow("a1")).toMatchObject({ machine_id: "machine-1", name: "A", character: JSON.stringify(character), deleted_at: entry.deletedAt, restore_until: entry.restoreUntil });

  // A Machine that does not say the Character (older than Characters) does not erase the one kept.
  await saveAgents(database, "machine-1", [], [{ id: "a1", name: "A", provider: "main", model: "model-a", deletedAt: entry.deletedAt, restoreUntil: entry.restoreUntil }]);
  expect(await trashRow("a1")).toMatchObject({ character: JSON.stringify(character) });

  // Restore: it is an Agent again and the trash no longer has it.
  await saveAgents(database, "machine-1", [agent], []);
  expect(await row()).toMatchObject({ id: "a1" });
  expect(await trashRow("a1")).toBeUndefined();
});

test("a Machine too old to keep deleted Agents clears its trash, and another Machine's trash stays", async () => {
  const entry = { ...agent, deletedAt: 1, restoreUntil: 2 };
  await saveAgents(database, "machine-1", [], [entry]);
  await saveAgents(database, "machine-2", [], [{ ...entry, id: "a3" }]);
  await saveAgents(database, "machine-1", [], undefined);
  const ids = (await database.query<{ id: string; machine_id: string }>("SELECT id, machine_id FROM agent_trash ORDER BY id")).map((row) => `${row.machine_id}:${row.id}`);
  expect(ids).toEqual(["machine-2:a3"]);
});

test("an answer that lists an Agent as in use takes it out of the trash", async () => {
  await saveAgents(database, "machine-1", [], [{ ...agent, deletedAt: 1, restoreUntil: 2 }]);
  await saveAgents(database, "machine-1", [agent], [{ ...agent, deletedAt: 1, restoreUntil: 2 }]);
  expect(await trashRow("a1")).toBeUndefined();
});
