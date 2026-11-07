import { TaskEventKind, type TaskEvent } from "@veeloe/protocol";
import type { Database } from "../../../shared/db";
import { plainFirstLine } from "../../../shared/lib";

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

/**
 * Tasks a Machine says this Member started, which this device may not have yet
 * (a linked device, or a browser whose storage was cleared). A row already here
 * is left as it is; the new ones come back so their events can be synced from 0.
 */
export function addListedTasks(database: Database, machine: string, tasks: { id: string; agent: string; updated: number }[]) {
  return database.write([TASK_TOPIC], async (transaction) => {
    const added: { id: string; agent: string }[] = [];
    for (const task of tasks) {
      const [known] = await transaction.all("SELECT 1 FROM task WHERE id = ?", [task.id]);
      if (known) continue;
      await transaction.run("INSERT INTO task (id, agent_id, machine_id, synced_seq, updated_at) VALUES (?, ?, ?, 0, ?)", [task.id, task.agent, machine, task.updated]);
      added.push(task);
    }
    return added;
  });
}

export function listTasks(database: Database) {
  return database.query<TaskRow>("SELECT * FROM task");
}

/** The Task to open when an Agent is tapped: the one with the latest activity. */
export async function latestTaskOf(database: Database, agentId: string) {
  const [row] = await database.query<{ id: string }>("SELECT id FROM task WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1", [agentId]);
  return row?.id ?? null;
}

/** Kinds this build knows; a newer Runtime's kind is skipped when working out what a Task is doing. */
const KNOWN: readonly string[] = Object.values(TaskEventKind);
const KNOWN_SQL = KNOWN.map((kind) => `'${kind}'`).join(", ");

/** The latest event of a kind this build knows: what a Task is doing, and how its Character carries itself. */
export type Latest = { latest_kind: string | null; latest_body: string | null };

/** A Task as lists show it: when it last moved, what it is doing, and its latest words. */
export type TaskSummary = TaskRow & Latest & { events: number; last_kind: string | null; last_body: string | null };

export const LIST_TASK_SUMMARIES = `SELECT t.*,
  (SELECT count(*) FROM task_event WHERE task_id = t.id) AS events,
  (SELECT kind FROM task_event WHERE task_id = t.id AND kind IN (${KNOWN_SQL}) ORDER BY seq DESC LIMIT 1) AS latest_kind,
  (SELECT body FROM task_event WHERE task_id = t.id AND kind IN (${KNOWN_SQL}) ORDER BY seq DESC LIMIT 1) AS latest_body,
  (SELECT kind FROM task_event WHERE task_id = t.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1) AS last_kind,
  (SELECT body FROM task_event WHERE task_id = t.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1) AS last_body
  FROM task t ORDER BY t.updated_at DESC`;

/** The latest words in a Task, as one plain line: the Member's, or the first line of the Agent's text. */
export function previewOf(summary: Pick<TaskSummary, "last_kind" | "last_body">): string {
  if (!summary.last_body) return "";
  try {
    const body = JSON.parse(summary.last_body) as { text?: unknown; content?: unknown };
    if (summary.last_kind === "member.message") return typeof body.text === "string" ? body.text.split("\n")[0]! : "";
    const text = Array.isArray(body.content) ? body.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n") : "";
    return plainFirstLine(text);
  } catch {
    return "";
  }
}

/** The same as a summary's, from a Task's events in order, for the screen that already has them all. */
export function latestOf(events: readonly Pick<TaskEventRow, "kind" | "body">[]): Latest {
  for (let i = events.length - 1; i >= 0; i--) if (KNOWN.includes(events[i]!.kind)) return { latest_kind: events[i]!.kind, latest_body: events[i]!.body };
  return { latest_kind: null, latest_body: null };
}

/** The latest event as the Character's moodOf takes it. */
export const latestEvents = ({ latest_kind, latest_body }: Latest) => (latest_kind ? [{ kind: latest_kind, body: latest_body }] : []);

/** What a Task is doing, in the prototype's words for it. `failed`: its latest Turn ended in an error. */
export type TaskStatus = "waiting" | "working" | "interrupted" | "failed" | "done" | "offline" | "new";

/**
 * Offline first; then from the latest known event: none is not started, an Approval
 * asked and not yet answered is waiting on a person, and anything else before
 * `turn.ended` is a Turn still running.
 */
export function statusOf(latest: Latest | undefined, online: boolean | null): TaskStatus {
  if (online === false) return "offline";
  if (!latest?.latest_kind) return "new";
  if (latest.latest_kind === TaskEventKind.ApprovalRequested) return "waiting";
  // A restart cut this Turn off (ADR 0033): the files are there, and a word carries it on.
  if (latest.latest_kind === TaskEventKind.TurnInterrupted) return "interrupted";
  if (latest.latest_kind !== TaskEventKind.TurnEnded) return "working";
  try {
    const reason = (JSON.parse(latest.latest_body ?? "null") as { reason?: unknown } | null)?.reason;
    if (reason === "done") return "done";
    // A Stop is a person ending the Turn, not a failure: the Task is finished, not broken (ADR 0017).
    if (reason === "stopped") return "done";
    return reason === "interrupted" ? "interrupted" : "failed";
  } catch {
    return "failed";
  }
}
