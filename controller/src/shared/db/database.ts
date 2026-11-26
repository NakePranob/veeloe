import type { SQLiteDatabase, SQLiteBindParams } from "expo-sqlite";

export type Connection = Pick<SQLiteDatabase, "execAsync" | "runAsync" | "getAllAsync" | "getFirstAsync" | "withTransactionAsync" | "closeAsync">;

/** What a write can do. Only this, so it cannot queue behind itself and hang. */
export type WriteTransaction = {
  run: (sql: string, params?: SQLiteBindParams) => Promise<unknown>;
  all: <Row>(sql: string, params?: SQLiteBindParams) => Promise<Row[]>;
};

export type Database = ReturnType<typeof createDatabase>;

/**
 * Each entry runs once, in order, and its version moves with it in the same
 * transaction, so a failed step leaves nothing behind and is tried again.
 * Entries are append-only: an edited one never runs on a database that has it.
 */
export async function migrate(connection: Connection, migrations: readonly string[]) {
  const row = await connection.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  for (let version = row?.user_version ?? 0; version < migrations.length; version++) {
    await connection.withTransactionAsync(async () => {
      await connection.execAsync(migrations[version]);
      await connection.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/**
 * One way in for every read and write (ADR 0021). withExclusiveTransactionAsync
 * does not exist on web, and without it a query on this connection would see a
 * transaction's rows before they commit, so everything goes through one queue.
 * ponytail: a read waits for the batch ahead of it; add a read connection on mobile if that is ever measured slow.
 */
export function createDatabase(connection: Connection) {
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<{ topics: readonly string[]; onChange: () => void }>();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  }

  return {
    query<Row>(sql: string, params: SQLiteBindParams = []) {
      return enqueue(() => connection.getAllAsync<Row>(sql, params));
    },

    /**
     * One batch: all of it commits or none does. Listeners of `topics` hear once,
     * after the commit, however many rows it wrote. ADR 0021 measured the row-by-row
     * change events at seconds for 1,000 rows, which is why they are not used.
     */
    async write<T>(topics: readonly string[], batch: (transaction: WriteTransaction) => Promise<T>): Promise<T> {
      const result = await enqueue(async () => {
        let value!: T;
        await connection.withTransactionAsync(async () => {
          value = await batch({
            run: (sql, params = []) => connection.runAsync(sql, params),
            all: <Row>(sql: string, params: SQLiteBindParams = []) => connection.getAllAsync<Row>(sql, params),
          });
        });
        return value;
      });
      for (const listener of [...listeners]) if (listener.topics.some((topic) => topics.includes(topic))) listener.onChange();
      return result;
    },

    subscribe(topics: readonly string[], onChange: () => void) {
      const listener = { topics, onChange };
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** After whatever is already queued, so nothing is cut off halfway. */
    close() {
      return enqueue(() => connection.closeAsync());
    },
  };
}
