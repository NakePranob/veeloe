import { createContext, use, useEffect, useState } from "react";
import type { SQLiteBindParams } from "expo-sqlite";
import type { Database } from "./database";

const DatabaseContext = createContext<Database | null>(null);

export const DatabaseProvider = DatabaseContext.Provider;

export function useDatabase() {
  const database = use(DatabaseContext);
  if (!database) throw new Error("useDatabase needs a DatabaseProvider above it");
  return database;
}

/** The shortest gap between two reads of one live query: a Turn writes events many times a second. */
const READ_GAP_MS = 200;

/**
 * Rows that stay current: read now, and again after each commit on `topics`, at most once per
 * READ_GAP_MS: commits in between are one read after the gap, so the last one is never missed.
 * Null until the first read lands, so a screen never shows "empty" while loading.
 */
export function useLiveQuery<Row>(sql: string, params: SQLiteBindParams, topics: readonly string[]) {
  const database = useDatabase();
  const [rows, setRows] = useState<Row[] | null>(null);
  const paramsKey = JSON.stringify(params);
  const topicsKey = topics.join("\n");

  useEffect(() => {
    let latest = 0;
    const read = () => {
      const mine = ++latest;
      database.query<Row>(sql, JSON.parse(paramsKey)).then(
        (next) => {
          if (mine === latest) setRows(next);
        },
        (error) => {
          // To the error boundary, unless this screen has moved on already.
          if (mine === latest)
            setRows(() => {
              throw error;
            });
        },
      );
    };
    let lastRead = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (timer) return;
      timer = setTimeout(
        () => {
          timer = null;
          lastRead = Date.now();
          read();
        },
        Math.max(0, lastRead + READ_GAP_MS - Date.now()),
      );
    };
    read();
    const unsubscribe = database.subscribe(topicsKey.split("\n"), changed);
    return () => {
      latest = -1;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [database, sql, paramsKey, topicsKey]);

  return rows;
}
