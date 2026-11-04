import { TaskEventKind, type TaskEvent } from "@veeloe/protocol";
import type { Database } from "../../../shared/db";

export const TASK_TOPIC = "task";

export type TaskRow = { id: string; agent_id: string; machine_id: string; synced_seq: number; updated_at: number };
export type TaskEventRow = { task_id: string; seq: number; kind: string; at: number; body: string };
export type PendingRow = { id: string; task_id: string; text: string; created_at: number; sig: string | null; error: string | null };

/**
 * Events from the Machine, in any order and any number of times: each lands
 * once by its number. `synced_seq` is where the run without a gap ends, which is
 * where the next sync starts. A Member's message coming back clears its pending copy.
 */
export function saveTaskEvents(database: Database, { task, agent, machine }: { task: string; agent: string; machine: string }, events: TaskEvent[]) {
  const latest = events.reduce((at, e) => Math.max(at, e.at), 0);
  return database.write([TASK_TOPIC], async (transaction) => {
    await transaction.run("INSERT OR IGNORE INTO task (id, agent_id, machine_id, updated_at) VALUES (?, ?, ?, ?)", [task, agent, machine, latest]);
    for (const event of events) {
      await transaction.run("INSERT OR IGNORE INTO task_event (task_id, seq, kind, at, body) VALUES (?, ?, ?, ?, ?)", [task, event.seq, event.kind, event.at, JSON.stringify(event.body ?? null)]);
      const id = (event.body as { id?: unknown } | null)?.id;
      if (event.kind === TaskEventKind.MemberMessage && typeof id === "string") await transaction.run("DELETE FROM pending_message WHERE id = ?", [id]);
    }
    const [current] = await transaction.all<{ synced_seq: number }>("SELECT synced_seq FROM task WHERE id = ?", [task]);
    let synced = current?.synced_seq ?? 0;
    const after = await transaction.all<{ seq: number }>("SELECT seq FROM task_event WHERE task_id = ? AND seq > ? ORDER BY seq", [task, synced]);
    for (const { seq } of after) {
      if (seq !== synced + 1) break;
      synced = seq;
    }
    await transaction.run("UPDATE task SET synced_seq = ?, updated_at = max(updated_at, ?) WHERE id = ?", [synced, latest, task]);
  });
}

/** A message the Owner sent, shown as sending until the Machine writes it into the log. */
export function addPendingMessage(database: Database, { id, task, agent, machine, text }: { id: string; task: string; agent: string; machine: string; text: string }) {
  return database.write([TASK_TOPIC], async (transaction) => {
    await transaction.run("INSERT OR IGNORE INTO task (id, agent_id, machine_id, updated_at) VALUES (?, ?, ?, ?)", [task, agent, machine, Date.now()]);
    await transaction.run("INSERT INTO pending_message (id, task_id, text, created_at) VALUES (?, ?, ?, ?)", [id, task, text, Date.now()]);
  });
}

/** Which envelope carried it, so an error naming that envelope finds it. Null when it could not go at all. */
export function markPendingSent(database: Database, id: string, sig: string | null) {
  return database.write([TASK_TOPIC], (transaction) =>
    sig ? transaction.run("UPDATE pending_message SET sig = ?, error = NULL WHERE id = ?", [sig, id]) : transaction.run("UPDATE pending_message SET error = ? WHERE id = ?", ["pairing.hub_unreachable", id]),
  );
}

/** True when an error was about a message this Controller sent. */
export async function failPendingMessage(database: Database, sig: string, code: string) {
  const [match] = await database.query<{ id: string }>("SELECT id FROM pending_message WHERE sig = ?", [sig]);
  if (!match) return false;
  await database.write([TASK_TOPIC], (transaction) => transaction.run("UPDATE pending_message SET error = ? WHERE id = ?", [code, match.id]));
  return true;
}

export function dismissPendingMessage(database: Database, id: string) {
  return database.write([TASK_TOPIC], (transaction) => transaction.run("DELETE FROM pending_message WHERE id = ?", [id]));
}

export function listTasks(database: Database) {
  return database.query<TaskRow>("SELECT * FROM task");
}

/** The Task to open when an Agent is tapped: the one with the latest activity. */
export async function latestTaskOf(database: Database, agentId: string) {
  const [row] = await database.query<{ id: string }>("SELECT id FROM task WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1", [agentId]);
  return row?.id ?? null;
}
