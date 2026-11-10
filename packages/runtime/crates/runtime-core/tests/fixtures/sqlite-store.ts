import { Database } from "bun:sqlite";

// A frozen copy of the retired TypeScript Runtime's `tasks.db` writer, kept only
// so the Rust store proves it still opens a database the old one wrote. Its
// TypeScript types went with that Runtime; the tests need the SQL, not them.
type TaskEvent = { seq: number; kind: string; at: number; body: unknown };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS task (id TEXT PRIMARY KEY NOT NULL, starter TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS event (
  task_id TEXT NOT NULL REFERENCES task(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  message_id TEXT UNIQUE,
  PRIMARY KEY (task_id, seq)
);
`;

type Row = { seq: number; kind: string; body: string; at: number };

/**
 * tasks.db beside the Workdir (ADR 0018, 0032). Numbers are counted inside the
 * insert's transaction, so they run 1, 2, 3 with no gap whatever happens around them.
 */
export function openEventStore(file: string, clock = { now: Date.now }) {
  const db = new Database(file, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const next = db.query<{ seq: number }, [string]>("SELECT coalesce(max(seq), 0) + 1 AS seq FROM event WHERE task_id = ?");
  const insert = db.query("INSERT INTO event (task_id, seq, kind, body, at, message_id) VALUES (?, ?, ?, ?, ?, ?)");
  const list = db.query<Row, [string, number]>("SELECT seq, kind, body, at FROM event WHERE task_id = ? AND seq > ? ORDER BY seq");
  // A Task whose latest Turn boundary is a start: its Turn was running when this worker ended (ADR 0033).
  // The last boundary decides, not the last event of any kind: a worker that died after an
  // `llm.message` still left a Turn open, and this is the query that has to see it (ADR 0033).
  const openTurnsQuery = db.query<{ task_id: string }, [string, string, string, string, string]>(
    `SELECT e.task_id FROM event e WHERE e.kind IN (?, ?)
     GROUP BY e.task_id HAVING (SELECT kind FROM event WHERE task_id = e.task_id AND kind IN (?, ?) ORDER BY seq DESC LIMIT 1) = ?`,
  );
  const append = db.transaction((task: string, kind: string, body: unknown, messageId?: string): TaskEvent => {
    const { seq } = next.get(task)!;
    const at = clock.now();
    insert.run(task, seq, kind, JSON.stringify(body), at, messageId ?? null);
    return { seq, kind, at, body };
  });
  return {
    starterOf: (task) => db.query<{ starter: string }, [string]>("SELECT starter FROM task WHERE id = ?").get(task)?.starter,
    createTask: (task, starter) => void db.query("INSERT INTO task (id, starter, created_at) VALUES (?, ?, ?)").run(task, starter, clock.now()),
    hasMessage: (id) => db.query("SELECT 1 FROM event WHERE message_id = ?").get(id) !== null,
    append: (task, kind, body, messageId) => append(task, kind, body, messageId),
    events: (task, after = 0) => list.all(task, after).map((row) => ({ seq: row.seq, kind: row.kind, at: row.at, body: JSON.parse(row.body) })),
    tasksStartedBy: (member) =>
      db.query<{ id: string; updated: number }, [string]>("SELECT t.id, coalesce((SELECT max(at) FROM event WHERE task_id = t.id), t.created_at) AS updated FROM task t WHERE t.starter = ?").all(member),
    openTurns: () => openTurnsQuery.all("turn.started", "turn.ended", "turn.started", "turn.ended", "turn.started").map((row) => row.task_id),
    close: () => db.close(),
  };
}
