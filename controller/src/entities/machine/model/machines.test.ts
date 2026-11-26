import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { egressOf, LIST_MACHINES, MACHINE_TOPIC, saveEgress, saveMachine, type Machine } from "./machines";

// The same statements as expo-sqlite, over Bun's own SQLite.
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

const machine = (id: string, paired_at: number): Machine => ({ id, public_key: `key-${id}`, name: `mac-${id}`, hub_url: "wss://hub.test", workspace_id: "w", member_id: "m", paired_at, egress: "[]", usage_fetched_at: null });

async function open() {
  const c = connection(new Sqlite(":memory:"));
  await migrate(c, MIGRATIONS);
  return createDatabase(c);
}

test("a saved Machine comes back in the order they were paired", async () => {
  const database = await open();
  await saveMachine(database, machine("b", 2));
  await saveMachine(database, machine("a", 1));
  expect(await database.query<Machine>(LIST_MACHINES)).toEqual([machine("a", 1), machine("b", 2)]);
});

test("saving tells whoever watches the list, and a repeat replaces instead of adding", async () => {
  const database = await open();
  let heard = 0;
  database.subscribe([MACHINE_TOPIC], () => heard++);
  await saveMachine(database, machine("a", 1));
  await saveMachine(database, { ...machine("a", 1), name: "renamed" });
  expect(heard).toBe(2);
  expect((await database.query<Machine>(LIST_MACHINES)).map((m) => m.name)).toEqual(["renamed"]);
});

test("the Egress a Machine said is written to its row and read back as a list, and pairing again starts it empty", async () => {
  const database = await open();
  await saveMachine(database, machine("a", 1));
  let heard = 0;
  database.subscribe([MACHINE_TOPIC], () => heard++);
  await saveEgress(database, "a", ["github.com", "*.npmjs.org"]);
  const [saved] = await database.query<Machine>(LIST_MACHINES);
  expect(egressOf(saved!)).toEqual(["github.com", "*.npmjs.org"]);
  expect(heard).toBe(1);
  await saveMachine(database, machine("a", 1));
  expect(egressOf((await database.query<Machine>(LIST_MACHINES))[0]!)).toEqual([]);
  expect(egressOf({ egress: "not json" })).toEqual([]);
});
