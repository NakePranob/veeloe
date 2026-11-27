import { TaskEventKind, TaskTitled, type TaskEvent } from "@veeloe/protocol-ts";
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
  // A new name is not activity: it leaves the Task where it sits in the Inbox and on the Agent page.
  const latest = events.reduce((at, e) => (e.kind === TaskTitled ? at : Math.max(at, e.at)), 0);
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
    // The Machine's "last moved" counts every event, a name too: once those land, this device has caught up to it.
    const landed = events.reduce((at, e) => Math.max(at, e.at), 0);
    await transaction.run("UPDATE task SET synced_seq = ?, updated_at = max(updated_at, ?), listed_updated = max(listed_updated, ?) WHERE id = ?", [synced, latest, landed, task]);
    // Worked out again from all its events, so events that arrive out of order still leave it right.
    await transaction.run(REFRESH_SUMMARY, [task]);
    await transaction.run(REFRESH_FLAGS, [task]);
  });
}

/** How long a Schedule round that ended with nothing to say keeps its log on this device. */
export const QUIET_KEPT_DAYS = 30;

/**
 * Frees the logs of quiet Schedule rounds older than QUIET_KEPT_DAYS: they are most of what a Schedule
 * leaves, and nobody reads them. The row stays, with its summary and where its sync got to, so the thread
 * still counts the round as "nothing" and the Machine is not asked for it again; opening one asks it then.
 */
export function pruneQuietRounds(database: Database, now = Date.now()) {
  const before = now - QUIET_KEPT_DAYS * 24 * 60 * 60 * 1000;
  return database.write([TASK_TOPIC], (transaction) => transaction.run("DELETE FROM task_event WHERE task_id IN (SELECT id FROM task WHERE quiet = 1 AND trigger_id IS NOT NULL AND updated_at < ?)", [before]));
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
 * The Tasks a Machine says this Member started, and which of them to sync: one this device does not
 * have yet (a linked device, a cleared store) from 0, and one that moved on the Machine since it was last
 * asked for from where this device's log ends. A Task that has not moved is not asked for: a Member with
 * thousands of Tasks sends a handful of syncs on connect, not thousands.
 */
export function addListedTasks(database: Database, machine: string, tasks: { id: string; agent: string; updated: number }[]) {
  return database.write([TASK_TOPIC], async (transaction) => {
    const toSync: { id: string; agent: string; after: number }[] = [];
    for (const task of tasks) {
      const [known] = await transaction.all<{ synced_seq: number; listed_updated: number }>("SELECT synced_seq, listed_updated FROM task WHERE id = ?", [task.id]);
      // Caught up is only what landed (saveTaskEvents), never what was asked for: a sync lost on the way is asked for again.
      if (!known) {
        await transaction.run("INSERT INTO task (id, agent_id, machine_id, synced_seq, updated_at) VALUES (?, ?, ?, 0, ?)", [task.id, task.agent, machine, task.updated]);
        toSync.push({ id: task.id, agent: task.agent, after: 0 });
      } else if (task.updated > known.listed_updated) {
        toSync.push({ id: task.id, agent: task.agent, after: known.synced_seq });
      }
    }
    return toSync;
  });
}

/** Kinds this build knows; a newer Runtime's kind is skipped when working out what a Task is doing. */
const KNOWN: readonly string[] = Object.values(TaskEventKind);
const KNOWN_SQL = KNOWN.map((kind) => `'${kind}'`).join(", ");

/** The latest event of a kind this build knows: what a Task is doing, and how its Character carries itself. */
export type Latest = { latest_kind: string | null; latest_body: string | null };

/** A Task as lists show it: when it last moved, what it is doing, its latest words, its name and its first message. */
export type TaskSummary = TaskRow & Latest & { events: number; last_kind: string | null; last_body: string | null; title_body: string | null; first_body: string | null; trigger_id: string | null; quiet: number };

/** What lists show of one Task, from its events, kept on its row (migration `task.events`). */
const REFRESH_SUMMARY = `UPDATE task SET
  events = (SELECT count(*) FROM task_event e WHERE e.task_id = task.id),
  latest_kind = (SELECT kind FROM task_event e WHERE e.task_id = task.id AND kind IN (${KNOWN_SQL}) ORDER BY seq DESC LIMIT 1),
  latest_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind IN (${KNOWN_SQL}) ORDER BY seq DESC LIMIT 1),
  last_kind = (SELECT kind FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1),
  last_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1),
  title_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind = '${TaskTitled}' ORDER BY seq DESC LIMIT 1),
  first_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind = 'member.message' ORDER BY seq LIMIT 1)
  WHERE id = ?`;

/** Read from the columns above, so in a second step: the Trigger a round came from, and whether it ended quietly. */
const REFRESH_FLAGS = `UPDATE task SET
  trigger_id = json_extract(first_body, '$.trigger.id'),
  quiet = coalesce(latest_kind = '${TaskEventKind.TurnEnded}' AND json_extract(latest_body, '$.reason') = 'quiet', 0)
  WHERE id = ?`;

/** Every Task, newest first: one row each, nothing searched. */
export const LIST_TASK_SUMMARIES = "SELECT * FROM task ORDER BY updated_at DESC";

/** One Agent's Tasks, newest first, at most `?` of them: a long list read a page at a time. */
export const LIST_AGENT_TASK_SUMMARIES = "SELECT * FROM task WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?";

/** How many Tasks one Agent has. */
export const COUNT_AGENT_TASKS = "SELECT count(*) AS count FROM task WHERE agent_id = ?";

/**
 * Each Agent's Task to show (the Inbox, the Agents and Machine pages): the newest one whose Turn is still
 * running, since Turns of different Tasks run at once (ADR 0080); else the newest that is news, which a
 * round that ended quietly is not. Only a Task that moved in the last six hours counts as running, so one
 * whose end never reached this device does not hold the row forever.
 */
export const LIST_LATEST_TASKS = `SELECT * FROM task t WHERE t.id = (
  SELECT n.id FROM task n WHERE n.agent_id = t.agent_id AND n.quiet = 0
  ORDER BY (n.latest_kind IS NOT NULL AND n.latest_kind != '${TaskEventKind.TurnEnded}'
    AND n.updated_at > strftime('%s', 'now') * 1000 - 6 * 3600 * 1000) DESC, n.updated_at DESC LIMIT 1
) ORDER BY t.updated_at DESC`;

/** The newest round of each Trigger of one Agent, with how many rounds it has; `?` is 1 to leave out threads deleted on this device. */
export const LIST_THREAD_HEADS = `SELECT t.*, (SELECT count(*) FROM task c WHERE c.trigger_id = t.trigger_id) AS rounds FROM task t
  WHERE t.agent_id = ? AND t.trigger_id IS NOT NULL
    AND (? = 0 OR t.trigger_id NOT IN (SELECT trigger_id FROM thread_hidden))
    AND t.id = (SELECT l.id FROM task l WHERE l.trigger_id = t.trigger_id ORDER BY l.updated_at DESC LIMIT 1)
  ORDER BY t.updated_at DESC`;

/** Every round of one Trigger, newest first. */
export const LIST_TRIGGER_ROUNDS = "SELECT * FROM task WHERE trigger_id = ? ORDER BY updated_at DESC";

/** The latest words in a Task, as one plain line: the Member's, or the first line of the Agent's text. */
export function previewOf(summary: Pick<TaskSummary, "last_kind" | "last_body">): string {
  if (!summary.last_body) return "";
  try {
    const body = JSON.parse(summary.last_body) as { text?: unknown; content?: unknown };
    if (summary.last_kind === "member.message") return typeof body.text === "string" ? (body.text.split("\n")[0] ?? "") : "";
    const text = Array.isArray(body.content)
      ? body.content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n")
      : "";
    return plainFirstLine(text);
  } catch {
    return "";
  }
}

/** What a Task is about: the name the Runtime gave it, or its first message's first line until then. Unlike `previewOf`, it stays put as the Task goes on. */
export function titleOf(summary: Pick<TaskSummary, "title_body" | "first_body">): string {
  const field = (body: string | null, key: "title" | "text") => {
    try {
      const value = (JSON.parse(body ?? "null") as Record<string, unknown> | null)?.[key];
      return typeof value === "string" ? (value.trim().split("\n")[0] ?? "") : "";
    } catch {
      return "";
    }
  };
  return field(summary.title_body, "title") || field(summary.first_body, "text");
}

/** `titleOf` from a Task's events in order, for its own page. */
export function titleOfEvents(events: readonly Pick<TaskEventRow, "kind" | "body">[]): string {
  const titled = events.filter((event) => event.kind === TaskTitled);
  const first = events.find((event) => event.kind === "member.message");
  return titleOf({ title_body: titled[titled.length - 1]?.body ?? null, first_body: first?.body ?? null });
}

/** The same as a summary's, from a Task's events in order, for the screen that already has them all. */
export function latestOf(events: readonly Pick<TaskEventRow, "kind" | "body">[]): Latest {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && KNOWN.includes(event.kind)) return { latest_kind: event.kind, latest_body: event.body };
  }
  return { latest_kind: null, latest_body: null };
}

/** The latest event as the Character's moodOf takes it. */
export const latestEvents = ({ latest_kind, latest_body }: Latest) => (latest_kind ? [{ kind: latest_kind, body: latest_body }] : []);

/** What a Task is doing, in the prototype's words for it. `failed`: its latest Turn ended in an error. */
export type TaskStatus = "waiting" | "working" | "stuck" | "interrupted" | "failed" | "done" | "offline" | "new";

/** An Approval waiting, a Turn that went quiet, failed or was cut off: the Owner has to look (the Inbox's needs-you tab). */
export const needsYou = (status: TaskStatus) => status === "waiting" || status === "stuck" || status === "failed" || status === "interrupted";

/** The colour of the dot beside a status: orange needs a person, red failed, blue running, green done, grey idle. */
export const STATUS_DOT = { waiting: "orange", stuck: "orange", interrupted: "orange", failed: "red", working: "blue", done: "green", new: "tertiaryLabel", offline: "tertiaryLabel" } as const satisfies Record<TaskStatus, string>;

/** The latest Turn stopped because today's token Budget ran out: a failure with a way out (add Budget). */
export function isBudgetOut(latest: Latest | undefined) {
  if (latest?.latest_kind !== TaskEventKind.TurnEnded) return false;
  try {
    return (JSON.parse(latest.latest_body ?? "null") as { code?: unknown } | null)?.code === "budget.exhausted";
  } catch {
    return false;
  }
}

/** A scheduled round ended with nothing to tell (issue #56): it stays out of the Inbox. */
export function isQuiet(latest: Latest | undefined) {
  if (latest?.latest_kind !== TaskEventKind.TurnEnded) return false;
  try {
    return (JSON.parse(latest.latest_body ?? "null") as { reason?: unknown } | null)?.reason === "quiet";
  } catch {
    return false;
  }
}

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
  // The Runtime saw the Turn go quiet past its stall time (ADR 0073); the next event clears it.
  if (latest.latest_kind === TaskEventKind.TurnStalled) return "stuck";
  if (latest.latest_kind !== TaskEventKind.TurnEnded) return "working";
  try {
    const reason = (JSON.parse(latest.latest_body ?? "null") as { reason?: unknown } | null)?.reason;
    if (reason === "done") return "done";
    // A Stop is a person ending the Turn, not a failure: the Task is finished, not broken (ADR 0017).
    if (reason === "stopped") return "done";
    // A round with nothing to report finished as asked (issue #56).
    if (reason === "quiet") return "done";
    return reason === "interrupted" ? "interrupted" : "failed";
  } catch {
    return "failed";
  }
}

/** Deletes a thread from this device's index (ADR 0061): its Tasks are left as they are. */
export function hideThread(database: Database, trigger: string) {
  return database.write([TASK_TOPIC], (transaction) => transaction.run("INSERT OR IGNORE INTO thread_hidden (trigger_id) VALUES (?)", [trigger]));
}
