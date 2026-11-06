import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import type { Agent } from "@veeloe/protocol";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { saveAgents, saveUsage } from "./agents";

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
