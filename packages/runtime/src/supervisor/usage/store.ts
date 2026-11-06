import { Database } from "bun:sqlite";
import { chmodSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { supervisorDir } from "../config";
import { readJsonFile } from "../json-file";
import { shiftDay } from "./day";

/** A tally file the supervisor cannot read: it stops rather than losing the morning's tokens without a word. */
export class UsageError extends Error {}

/** One Agent's range, as `usage.listed` wants it. Days with no counted answer are absent, never zero. */
export type UsageRangeAgent = {
  agent: string;
  days: { day: string; tokens: number }[];
  /** At most 20, the biggest first. Tokens not tied to a Task are in the days, not here. */
  tasks: { task: string; tokens: number }[];
  sources: { source: string; tokens: number }[];
};

type Row<T> = T;

/**
 * Token usage history, one row per (Agent, Budget day, source, Task), in the
 * supervisor's own SQLite file (ADR 0014, 0066). The same rows are what today's
 * Budget is enforced against, so there is never a second tally.
 */
export function createUsageStore({ home, keepDays = 30, log = () => {} }: { home: string; keepDays?: number; log?: (line: string) => void }) {
  const dir = supervisorDir(home);
  const file = join(dir, "usage.db");
  const legacy = join(dir, "usage.json");
  const db = new Database(file);
  try {
    // SQLite makes the file with the umask; the tally is the owner's alone.
    chmodSync(file, 0o600);
  } catch {
    // A file system that cannot chmod is still usable; the folder is already 0700.
    log(`could not make ${file} owner-only; the supervisor folder is already 0700`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      agent  TEXT NOT NULL,
      day    TEXT NOT NULL,
      source TEXT NOT NULL,
      task   TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL,
      PRIMARY KEY (agent, day, source, task)
    );
    CREATE INDEX IF NOT EXISTS usage_by_day ON usage (day);
  `);

  const insert = db.prepare("INSERT INTO usage (agent, day, source, task, tokens) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent, day, source, task) DO UPDATE SET tokens = tokens + excluded.tokens");
  let lastDay: string | undefined;
  let closed = false;

  function add(agent: string, day: string, source: string, task: string, tokens: number) {
    if (!Number.isInteger(tokens) || tokens < 0) return;
    if (tokens > 0) insert.run(agent, day, source, task, tokens);
    // A new Budget day is when the oldest one leaves; nothing runs on a timer (ADR 0043).
    if (lastDay !== day) {
      prune(day);
      lastDay = day;
    }
  }

  /** Drops days older than `keepDays` counting today, so 30 days means today and the 29 before it. */
  function prune(today: string) {
    db.prepare("DELETE FROM usage WHERE day < ?").run(shiftDay(today, -(keepDays - 1)));
  }

  function total(agent: string, day: string): number {
    const row = db.prepare("SELECT COALESCE(SUM(tokens), 0) AS tokens FROM usage WHERE agent = ? AND day = ?").get(agent, day) as { tokens: number } | null;
    return row?.tokens ?? 0;
  }

  function range({ agents, from, to }: { agents: string[]; from: string; to: string }): UsageRangeAgent[] {
    const days = db.prepare("SELECT day, SUM(tokens) AS tokens FROM usage WHERE agent = ? AND day >= ? AND day <= ? GROUP BY day ORDER BY day");
    const tasks = db.prepare("SELECT task, SUM(tokens) AS tokens FROM usage WHERE agent = ? AND day >= ? AND day <= ? AND task <> '' GROUP BY task ORDER BY tokens DESC, task LIMIT 20");
    const sources = db.prepare("SELECT source, SUM(tokens) AS tokens FROM usage WHERE agent = ? AND day >= ? AND day <= ? GROUP BY source ORDER BY tokens DESC");
    return agents.flatMap((agent) => {
      const keptDays = days.all(agent, from, to) as Row<{ day: string; tokens: number }>[];
      const keptTasks = tasks.all(agent, from, to) as Row<{ task: string; tokens: number }>[];
      const keptSources = sources.all(agent, from, to) as Row<{ source: string; tokens: number }>[];
      // An Agent with nothing in the range is left out rather than shown as a row of zeroes.
      return keptDays.length === 0 ? [] : [{ agent, days: keptDays, tasks: keptTasks, sources: keptSources }];
    });
  }

  /**
   * The tally `daily-budget` kept in `usage.json`, brought in once and renamed so
   * it is never read again. A broken file stops the supervisor instead of losing
   * the morning's tokens without a word.
   */
  function importLegacy() {
    if (!existsSync(legacy)) return;
    let value: unknown;
    try {
      value = readJsonFile(legacy);
    } catch (err) {
      throw new UsageError(`cannot read ${legacy}: ${(err as Error).message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError(`cannot read ${legacy}: expected a set of tallies`);
    const entries = value as Record<string, { day?: unknown; tokens?: unknown }>;
    const empty = (db.prepare("SELECT COUNT(*) AS n FROM usage").get() as { n: number }).n === 0;
    if (empty) {
      db.transaction(() => {
        for (const [agent, tally] of Object.entries(entries)) {
          const day = typeof tally?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tally.day) ? tally.day : undefined;
          const tokens = typeof tally?.tokens === "number" && Number.isInteger(tally.tokens) && tally.tokens > 0 ? tally.tokens : 0;
          if (!day || tokens === 0) {
            log(`usage.json: skipped a tally that is not a day and a whole number (${agent})`);
            continue;
          }
          // The old file only knew a day and an Agent, so the Task is unnamed.
          insert.run(agent, day, "task", "", tokens);
        }
      })();
    }
    rmSync(`${legacy}.migrated`, { force: true });
    renameSync(legacy, `${legacy}.migrated`);
  }

  return {
    add,
    total,
    range,
    prune,
    importLegacy,
    /** Lets the process end and a test clean its folder; calling it twice is harmless. */
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

export type UsageStore = ReturnType<typeof createUsageStore>;
