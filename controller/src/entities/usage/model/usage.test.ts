import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { saveUsageFetchedAt, saveUsageHistory } from "./usage";

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

const body = (agents: { agent: string; days: { day: string; tokens: number }[] }[], to = "2026-11-06") => ({
  request: "req-1",
  from: "2026-10-31",
  to,
  agents: agents.map((a) => ({ ...a, tasks: [], sources: [] })),
});

let database: ReturnType<typeof createDatabase>;
let sqlite: Connection;
beforeEach(async () => {
  sqlite = connect();
  await migrate(sqlite, MIGRATIONS);
  database = createDatabase(sqlite);
  await sqlite.execAsync("INSERT INTO machine (id, public_key, name, hub_url, workspace_id, member_id, paired_at) VALUES ('machine-1', 'k', 'mac', 'ws://hub', 'w', 'mem', 1)");
  await sqlite.execAsync("INSERT INTO agent (id, machine_id, name, provider, model) VALUES ('a1', 'machine-1', 'A', 'main', 'model-a'), ('a2', 'machine-1', 'B', 'main', 'model-a')");
});

const rows = () => database.query<{ agent_id: string; day: string; tokens: number }>("SELECT agent_id, day, tokens FROM usage_day ORDER BY agent_id, day");

test("a Machine's answer is kept day by day, and a later answer for the same day replaces it", async () => {
  await saveUsageHistory(database, "machine-1", body([{ agent: "a1", days: [{ day: "2026-11-05", tokens: 100 }, { day: "2026-11-06", tokens: 200 }] }]));
  expect(await rows()).toEqual([
    { agent_id: "a1", day: "2026-11-05", tokens: 100 },
    { agent_id: "a1", day: "2026-11-06", tokens: 200 },
  ]);

  await saveUsageHistory(database, "machine-1", body([{ agent: "a1", days: [{ day: "2026-11-06", tokens: 250 }] }]));
  expect(await rows()).toEqual([
    { agent_id: "a1", day: "2026-11-06", tokens: 250 },
  ]);
});

test("the answered range is the truth: days it omits, days it corrects and Agents it leaves out all go", async () => {
  await sqlite.execAsync("INSERT INTO usage_day (agent_id, day, tokens) VALUES ('a1', '2026-11-05', 999), ('a2', '2026-11-06', 7)");
  await saveUsageHistory(database, "machine-1", body([{ agent: "a1", days: [{ day: "2026-11-06", tokens: 5 }] }]));
  expect(await rows()).toEqual([{ agent_id: "a1", day: "2026-11-06", tokens: 5 }]);
});

test("a day older than the 30 the Machine keeps leaves, including for an Agent with nothing in the answer", async () => {
  await sqlite.execAsync("INSERT INTO usage_day (agent_id, day, tokens) VALUES ('a1', '2026-10-01', 1), ('a2', '2026-10-01', 2)");
  await saveUsageHistory(database, "machine-1", body([{ agent: "a1", days: [{ day: "2026-11-06", tokens: 5 }] }]));
  expect(await rows()).toEqual([{ agent_id: "a1", day: "2026-11-06", tokens: 5 }]);
});

test("the time the Machine last answered is kept per Machine", async () => {
  expect((await database.query<{ usage_fetched_at: number | null }>("SELECT usage_fetched_at FROM machine"))[0]!.usage_fetched_at).toBeNull();
  await saveUsageFetchedAt(database, "machine-1", 1_800_000_000_000);
  expect(await database.query("SELECT usage_fetched_at FROM machine")).toEqual([{ usage_fetched_at: 1_800_000_000_000 }]);
});
