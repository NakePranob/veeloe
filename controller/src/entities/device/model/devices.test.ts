import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { LIST_DEVICES, renameDevice, type Device } from "./devices";

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

async function open() {
  const c = connection(new Sqlite(":memory:"));
  await migrate(c, MIGRATIONS);
  return createDatabase(c);
}

const device = (key: string, name: string, revoked_at: number | null = null): Device => ({ key, member_id: "m_1", name, linked_by: null, linked_at: null, revoked_at });

test("renaming a live Controller keeps the new name on this device", async () => {
  const database = await open();
  await database.write(["device"], (transaction) => transaction.run("INSERT INTO device (key, member_id, name) VALUES (?, ?, ?)", ["phone", "m_1", "Phone"]));
  expect(await renameDevice(database, "phone", " Work phone ")).toBe(true);
  expect(await database.query<Device>(LIST_DEVICES)).toEqual([device("phone", "Work phone")]);
});

test("a revoked Controller keeps the name it had", async () => {
  const database = await open();
  await database.write(["device"], (transaction) => transaction.run("INSERT INTO device (key, member_id, name, revoked_at) VALUES (?, ?, ?, ?)", ["old", "m_1", "Old phone", 10]));
  expect(await renameDevice(database, "old", "New name")).toBe(false);
  expect(await database.query<Device>(LIST_DEVICES)).toEqual([device("old", "Old phone", 10)]);
});

test("an unknown Controller is not created by renaming", async () => {
  const database = await open();
  expect(await renameDevice(database, "missing", "Phone")).toBe(false);
  expect(await database.query<Device>(LIST_DEVICES)).toEqual([]);
});
