import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../db/database";
import { MIGRATIONS } from "../db/migrations";
import { createSeenSequences } from "./seen";

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

let database: ReturnType<typeof createDatabase>;
beforeEach(async () => {
  const connection = connect();
  await migrate(connection, MIGRATIONS);
  database = createDatabase(connection);
});

test("a kept number outlives the process, so a replay after a restart is still refused", async () => {
  const first = createSeenSequences(database);
  await first.ready;
  expect(first.seen.last("key-a")).toBeUndefined();
  first.seen.record("key-a", 7);
  await first.settled();

  // A new Controller process reads what the last one kept.
  const again = createSeenSequences(database);
  await again.ready;
  expect(again.seen.last("key-a")).toBe(7);
  expect(again.seen.last("key-b")).toBeUndefined();
});

test("the number only goes up, and a lower one changes nothing", async () => {
  const first = createSeenSequences(database);
  const { seen, ready } = first;
  await ready;
  seen.record("key-a", 9);
  seen.record("key-a", 4);
  expect(seen.last("key-a")).toBe(9);
  await first.settled();
  const again = createSeenSequences(database);
  await again.ready;
  expect(again.seen.last("key-a")).toBe(9);
});
