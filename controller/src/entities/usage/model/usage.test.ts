import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { agentTotals, dailyTotals, saveUsageFetchedAt, saveUsageHistory } from "./usage";

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
  await saveUsageHistory(
    database,
    "machine-1",
    body([
      {
        agent: "a1",
        days: [
          { day: "2026-11-05", tokens: 100 },
          { day: "2026-11-06", tokens: 200 },
        ],
      },
    ]),
  );
  expect(await rows()).toEqual([
    { agent_id: "a1", day: "2026-11-05", tokens: 100 },
    { agent_id: "a1", day: "2026-11-06", tokens: 200 },
  ]);

  await saveUsageHistory(database, "machine-1", body([{ agent: "a1", days: [{ day: "2026-11-06", tokens: 250 }] }]));
  expect(await rows()).toEqual([{ agent_id: "a1", day: "2026-11-06", tokens: 250 }]);
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

test("each day of a range is a column, across a month and a year, totalled over its own Agents, a day with no row a gap", () => {
  const rows = [
    { agent_id: "a1", day: "2026-12-30", tokens: 10 },
    { agent_id: "a1", day: "2027-01-01", tokens: 20 },
    { agent_id: "a2", day: "2027-01-01", tokens: 30 },
    { agent_id: "a3", day: "2027-01-01", tokens: 99 },
  ];
  expect(dailyTotals(rows, new Set(["a1", "a2"]), "2026-12-31", "2027-01-01")).toEqual([
    { day: "2026-12-31", tokens: 0, known: false },
    { day: "2027-01-01", tokens: 50, known: true },
  ]);
  expect(dailyTotals(rows, new Set(["a1"]), "2027-01-02", "2027-01-01")).toEqual([]);
});

test("each Agent's total counts the same days as the chart, so the rows under it add up to it", () => {
  const rows = [
    { agent_id: "a1", day: "2026-11-21", tokens: 500 },
    { agent_id: "a1", day: "2026-11-22", tokens: 100 },
    { agent_id: "a2", day: "2026-11-22", tokens: 6 },
    { agent_id: "a2", day: "2026-11-23", tokens: 9 },
  ];
  const totals = agentTotals(rows, "2026-11-22", "2026-11-22");
  expect(totals).toEqual(
    new Map([
      ["a1", 100],
      ["a2", 6],
    ]),
  );
  const chart = dailyTotals(rows, new Set(["a1", "a2"]), "2026-11-22", "2026-11-22");
  expect([...totals.values()].reduce((sum, tokens) => sum + tokens, 0)).toBe(chart.reduce((sum, day) => sum + day.tokens, 0));
});
