import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { addJoined, LIST_ASKS, refuseAsk, saveAsk } from "./invite";

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

test("a request waits until let in, and one refused stays refused while they keep asking", async () => {
  const connection = connect();
  await migrate(connection, MIGRATIONS);
  const database = createDatabase(connection);
  await connection.runAsync("INSERT INTO invitation (id, hub_url, workspace_id, member_id, secret, link, max_members, expires_at, grants, created_at) VALUES ('inv', 'wss://hub', 'w', 'm', 's', 'l', 2, 9999999999, '[]', 1)", [] as never[]);
  const kai = { key: "key-kai", name: "Kai", code: "AAA-BBB" };
  const lee = { key: "key-lee", name: "Lee", code: "CCC-DDD" };
  await saveAsk(database, "inv", kai, 1);
  await saveAsk(database, "inv", lee, 2);
  await saveAsk(database, "inv", kai, 3);
  const waiting = () => database.query<{ key: string }>(LIST_ASKS, ["inv"]);
  expect((await waiting()).map((a) => a.key)).toEqual(["key-kai", "key-lee"]);
  await refuseAsk(database, "key-lee");
  await saveAsk(database, "inv", lee, 4);
  expect((await waiting()).map((a) => a.key)).toEqual(["key-kai"]);
  await addJoined(database, "inv", { key: "key-kai", member: "m_kai", name: "Kai" });
  expect(await waiting()).toEqual([]);
});
