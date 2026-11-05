import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import { addPendingMessage, failPendingMessage, latestOf, LIST_TASK_SUMMARIES, markPendingSent, saveTaskEvents, statusOf, TASK_TOPIC, type PendingRow, type TaskEventRow, type TaskRow, type TaskSummary } from "./tasks";

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

async function open() {
  const c = connection(new Sqlite(":memory:"));
  await migrate(c, MIGRATIONS);
  return createDatabase(c);
}

const where = { task: "t1", agent: "a1", machine: "mac" };
const event = (seq: number, kind = "llm.message", body: unknown = {}) => ({ seq, kind, at: 1000 + seq, body });
const task = async (database: Awaited<ReturnType<typeof open>>) => (await database.query<TaskRow>("SELECT * FROM task WHERE id = 't1'"))[0]!;
const seqs = async (database: Awaited<ReturnType<typeof open>>) => (await database.query<{ seq: number }>("SELECT seq FROM task_event ORDER BY seq")).map((r) => r.seq);

test("events land once each by number, and sync starts where the run without a gap ends", async () => {
  const database = await open();
  await saveTaskEvents(database, where, [event(2), event(1)]);
  await saveTaskEvents(database, where, [event(2), event(4)]);
  expect(await seqs(database)).toEqual([1, 2, 4]);
  expect((await task(database)).synced_seq).toBe(2);
  await saveTaskEvents(database, where, [event(3)]);
  expect((await task(database)).synced_seq).toBe(4);
  expect((await task(database)).updated_at).toBe(1004);
});

test("a gap at the start keeps sync at zero", async () => {
  const database = await open();
  await saveTaskEvents(database, where, [event(2), event(3)]);
  expect((await task(database)).synced_seq).toBe(0);
});

test("a pending message goes when the Machine writes it into the log, and one batch tells listeners once", async () => {
  const database = await open();
  await addPendingMessage(database, { id: "m1", task: "t1", agent: "a1", machine: "mac", text: "hi" });
  let heard = 0;
  database.subscribe([TASK_TOPIC], () => heard++);
  await saveTaskEvents(database, where, [event(1, "member.message", { member: "m_1", id: "m1", text: "hi" }), event(2, "turn.started")]);
  expect(heard).toBe(1);
  expect(await database.query("SELECT * FROM pending_message")).toEqual([]);
});

test("a summary's status comes from its latest known event: failed, still running, not started, and a newer kind skipped", async () => {
  const database = await open();
  const status = async () => {
    const summaries = await database.query<TaskSummary>(LIST_TASK_SUMMARIES);
    const events = await database.query<TaskEventRow>("SELECT * FROM task_event WHERE task_id = 't1' ORDER BY seq");
    const fromSummary = statusOf(summaries.find((s) => s.id === "t1"), true);
    // The Task screen works it out from the events it has, and must agree with the lists.
    expect(statusOf(latestOf(events), true)).toBe(fromSummary);
    return fromSummary;
  };
  await addPendingMessage(database, { id: "m1", task: "t1", agent: "a1", machine: "mac", text: "hi" });
  expect(await status()).toBe("new");
  await saveTaskEvents(database, where, [event(1, "member.message", { id: "m1", text: "hi" }), event(2, "turn.started")]);
  expect(await status()).toBe("working");
  await saveTaskEvents(database, where, [event(3, "turn.ended", { reason: "error", code: "provider.unreachable" })]);
  expect(await status()).toBe("failed");
  await saveTaskEvents(database, where, [event(4, "turn.started"), event(5, "turn.ended", { reason: "done" }), event(6, "future.thing")]);
  expect(await status()).toBe("done");
  expect(statusOf(undefined, false)).toBe("offline");
});

test("an error naming the envelope marks only that message as failed", async () => {
  const database = await open();
  await addPendingMessage(database, { id: "m1", task: "t1", agent: "a1", machine: "mac", text: "one" });
  await addPendingMessage(database, { id: "m2", task: "t1", agent: "a1", machine: "mac", text: "two" });
  await markPendingSent(database, "m1", "sig-1");
  await markPendingSent(database, "m2", "sig-2");
  expect(await failPendingMessage(database, "sig-2", "agent.busy")).toBe(true);
  expect(await failPendingMessage(database, "sig-unknown", "agent.busy")).toBe(false);
  const rows = await database.query<PendingRow>("SELECT id, error FROM pending_message ORDER BY id");
  expect(rows).toEqual([{ id: "m1", error: null }, { id: "m2", error: "agent.busy" }] as never);
});
