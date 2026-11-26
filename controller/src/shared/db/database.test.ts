import { Database as BunDatabase } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "./database";

// Real SQL on bun:sqlite, behind the few methods expo-sqlite gives the app.
function connect(sqlite = new BunDatabase(":memory:")): Connection {
  const connection = {
    execAsync: async (sql: string) => void sqlite.exec(sql),
    runAsync: async (sql: string, params: never[]) => sqlite.prepare(sql).run(...params),
    getAllAsync: async (sql: string, params: never[] = []) => sqlite.prepare(sql).all(...params),
    getFirstAsync: async (sql: string) => sqlite.prepare(sql).get(),
    withTransactionAsync: async (task: () => Promise<void>) => {
      sqlite.exec("BEGIN");
      try {
        await task();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => sqlite.close(),
  };
  return connection as unknown as Connection;
}

const version = async (connection: Connection) => (await connection.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version;
const CREATE_T = "CREATE TABLE t (n INTEGER)";

let connection: Connection;
beforeEach(() => {
  connection = connect();
});

test("migrations run in order, and only the new ones run on an older database", async () => {
  await migrate(connection, [CREATE_T]);
  expect(await version(connection)).toBe(1);
  // Would fail with "table t already exists" if the first ran again.
  await migrate(connection, [CREATE_T, "INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (2)"]);
  expect(await version(connection)).toBe(3);
  expect(await connection.getAllAsync("SELECT n FROM t ORDER BY rowid")).toEqual([{ n: 1 }, { n: 2 }]);
});

test("a failed migration leaves nothing behind and does not move the version", async () => {
  await migrate(connection, [CREATE_T]);
  const broken = [CREATE_T, "INSERT INTO t VALUES (1); INSERT INTO nowhere VALUES (1)"];
  expect(migrate(connection, broken)).rejects.toThrow();
  await Bun.sleep(0);
  expect(await version(connection)).toBe(1);
  expect(await connection.getAllAsync("SELECT n FROM t")).toEqual([]);
});

test("a batch tells its listeners once, after the commit, with every row visible", async () => {
  await migrate(connection, [CREATE_T]);
  const db = createDatabase(connection);
  const seen: number[] = [];
  db.subscribe(["t"], () => void db.query<{ n: number }>("SELECT count(*) AS n FROM t").then(([row]) => seen.push(row.n)));
  await db.write(["t"], async ({ run }) => {
    for (let n = 0; n < 1000; n++) await run("INSERT INTO t VALUES (?)", [n]);
  });
  await db.query("SELECT 1");
  expect(seen).toEqual([1000]);
});

test("a listener on several topics of one batch still hears once", async () => {
  const db = createDatabase(connection);
  let heard = 0;
  db.subscribe(["a", "b"], () => heard++);
  await db.write(["a", "b"], async () => {});
  expect(heard).toBe(1);
});

test("a batch that fails keeps none of its rows, tells nobody, and the queue goes on", async () => {
  await migrate(connection, [CREATE_T]);
  const db = createDatabase(connection);
  let heard = 0;
  db.subscribe(["t"], () => heard++);
  await expect(
    db.write(["t"], async ({ run }) => {
      await run("INSERT INTO t VALUES (1)");
      throw new Error("halfway");
    }),
  ).rejects.toThrow("halfway");
  expect(heard).toBe(0);
  expect(await db.query("SELECT n FROM t")).toEqual([]);
});

test("a read during a batch does not see rows that have not committed", async () => {
  await migrate(connection, [CREATE_T]);
  const db = createDatabase(connection);
  let finishBatch!: () => void;
  const inBatch = new Promise<void>((resolve) => {
    void db.write(["t"], async ({ run }) => {
      await run("INSERT INTO t VALUES (1)");
      resolve();
      await new Promise<void>((release) => (finishBatch = release));
    });
  });
  await inBatch;
  const read = db.query("SELECT n FROM t");
  finishBatch();
  // The read waited its turn, so it sees the committed row, and it can only be the whole batch.
  expect(await read).toEqual([{ n: 1 }]);
});

test("a read that a failing batch delayed does not see the rolled-back row", async () => {
  await migrate(connection, [CREATE_T]);
  const db = createDatabase(connection);
  let failBatch!: (reason: Error) => void;
  let reached!: () => void;
  const inBatch = new Promise<void>((resolve) => (reached = resolve));
  const batch = db.write(["t"], async ({ run }) => {
    await run("INSERT INTO t VALUES (1)");
    reached();
    await new Promise<void>((_, reject) => (failBatch = reject));
  });
  await inBatch;
  const read = db.query("SELECT n FROM t");
  failBatch(new Error("halfway"));
  await expect(batch).rejects.toThrow("halfway");
  expect(await read).toEqual([]);
});

test("a screen does not hear about a topic it did not listen for", async () => {
  const db = createDatabase(connection);
  let heard = 0;
  db.subscribe(["agents"], () => heard++);
  await db.write(["tasks"], async () => {});
  expect(heard).toBe(0);
});

test("after unsubscribing, a listener hears nothing", async () => {
  const db = createDatabase(connection);
  let heard = 0;
  const unsubscribe = db.subscribe(["t"], () => heard++);
  unsubscribe();
  await db.write(["t"], async () => {});
  expect(heard).toBe(0);
});

test("the real list stays append-only: a database migrated before approval-and-allowlist upgrades cleanly", async () => {
  const { MIGRATIONS } = await import("./migrations");
  const usageDay = MIGRATIONS.findIndex((m) => m.includes("CREATE TABLE usage_day"));
  expect(usageDay).toBeGreaterThan(-1);
  // Everything after `usage_day` must be a later change's own entry: an older
  // device replays from its version, so inserting before it would rerun it.
  for (const later of MIGRATIONS.slice(usageDay + 1)) expect(later).not.toContain("CREATE TABLE usage_day");

  await migrate(connection, MIGRATIONS.slice(0, usageDay + 1));
  await connection.runAsync("INSERT INTO agent (id, machine_id, name, provider, model) VALUES (?, ?, ?, ?, ?)", ["a1", "m1", "A", "main", "model-a"] as never[]);
  await migrate(connection, MIGRATIONS);
  const columns = await connection.getAllAsync<{ name: string }>("PRAGMA table_info(agent)");
  expect(columns.map((c) => c.name)).toContain("allowlist");
  expect(columns.map((c) => c.name)).toContain("approval_timeout_s");
  expect(await connection.getAllAsync("SELECT id, name FROM agent")).toEqual([{ id: "a1", name: "A" }]);
});
