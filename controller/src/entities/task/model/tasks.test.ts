import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createDatabase, migrate, type Connection } from "../../../shared/db/database";
import { MIGRATIONS } from "../../../shared/db/migrations";
import {
  addPendingMessage,
  failPendingMessage,
  isBudgetOut,
  latestOf,
  LIST_TASK_SUMMARIES,
  markPendingSent,
  saveTaskEvents,
  statusOf,
  TASK_TOPIC,
  titleOf,
  titleOfEvents,
  type PendingRow,
  type TaskEventRow,
  type TaskRow,
  type TaskSummary,
} from "./tasks";

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
    const fromSummary = statusOf(
      summaries.find((s) => s.id === "t1"),
      true,
    );
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
  // A name after the Turn says nothing about what the Task is doing.
  await saveTaskEvents(database, where, [event(7, "task.titled", { title: "Fixing CI" })]);
  expect(await status()).toBe("done");
});

test("a Task's title is its latest name, else its first message's first line, and stays put as the Task goes on", async () => {
  const database = await open();
  const title = async () => titleOf((await database.query<TaskSummary>(LIST_TASK_SUMMARIES))[0]!);
  await saveTaskEvents(database, where, [event(1, "turn.started")]);
  expect(await title()).toBe("");
  await saveTaskEvents(database, where, [event(2, "member.message", { id: "m1", text: "ช่วยดู CI\nมันแดง" }), event(3, "llm.message", { content: [{ type: "text", text: "ได้" }] })]);
  expect(await title()).toBe("ช่วยดู CI");
  await saveTaskEvents(database, where, [event(4, "task.titled", { title: "ดูว่าทำไม CI แดง" }), event(5, "member.message", { id: "m2", text: "อีกเรื่อง" })]);
  expect(await title()).toBe("ดูว่าทำไม CI แดง");
  await saveTaskEvents(database, where, [event(6, "task.titled", { title: "CI กับ lint" })]);
  expect(await title()).toBe("CI กับ lint");
  const updated = async () => (await database.query<TaskSummary>(LIST_TASK_SUMMARIES))[0]?.updated_at;
  const before = await updated();
  await saveTaskEvents(database, where, [{ ...event(7, "task.titled", { title: "ชื่อใหม่", member: "m1" }), at: 9_999_999_999_999 }]);
  expect(await updated()).toBe(before);
  expect(titleOf({ title_body: "not json", first_body: null })).toBe("");
  expect(titleOf({ title_body: JSON.stringify({ title: 3 }), first_body: JSON.stringify({ text: "hi" }) })).toBe("hi");
});

test("a Task's page reads the same name from its events: the latest one, or the first message until then", () => {
  const row = (kind: string, body: object) => ({ kind, body: JSON.stringify(body) });
  const first = row("member.message", { text: "what is git rebase" });
  expect(titleOfEvents([])).toBe("");
  expect(titleOfEvents([first, row("member.message", { text: "Thanks" })])).toBe("what is git rebase");
  expect(titleOfEvents([first, row("task.titled", { title: "Understanding git rebase" }), row("member.message", { text: "Thanks" })])).toBe("Understanding git rebase");
  expect(titleOfEvents([first, row("task.titled", { title: "Old" }), row("task.titled", { title: "New" })])).toBe("New");
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
  expect(rows).toEqual([
    { id: "m1", error: null },
    { id: "m2", error: "agent.busy" },
  ] as never);
});

test("a Turn a Stop ended is finished, and one a restart cut off says so", () => {
  const ended = (reason: string) => [{ kind: "turn.ended", body: JSON.stringify({ reason }) }];
  expect(statusOf({ latest_kind: "turn.ended", latest_body: JSON.stringify({ reason: "stopped" }) }, true)).toBe("done");
  expect(statusOf({ latest_kind: "turn.ended", latest_body: JSON.stringify({ reason: "interrupted" }) }, true)).toBe("interrupted");
  expect(ended("stopped")).toHaveLength(1);
  // The event of a restart on its own says it too, before the Turn's end lands.
  expect(statusOf({ latest_kind: "turn.interrupted", latest_body: JSON.stringify({ reason: "restart" }) }, true)).toBe("interrupted");
});

test("only a Turn that ended on today's Budget counts as Budget out", () => {
  expect(isBudgetOut({ latest_kind: "turn.ended", latest_body: JSON.stringify({ reason: "error", code: "budget.exhausted" }) })).toBe(true);
  expect(isBudgetOut({ latest_kind: "turn.ended", latest_body: JSON.stringify({ reason: "error", code: "provider.failed" }) })).toBe(false);
  expect(isBudgetOut(undefined)).toBe(false);
});
