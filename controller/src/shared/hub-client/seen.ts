import type { SeenSequences } from "@veeloe/protocol";
import type { Database } from "../db";

/**
 * The last envelope number from each sender, kept in the database beside
 * everything else on this device (ADR 0012, `protocol-envelope`). The Runtime
 * keeps its own; a Controller that forgot after a restart would accept an old
 * signed envelope a hostile Hub replays once.
 *
 * `verify` wants the number synchronously, so it is read once into memory and
 * written through: `ready` must be awaited before the first envelope is checked.
 */
export function createSeenSequences(database: Database) {
  const last = new Map<string, number>();
  const ready = database
    .query<{ sender_key: string; seq: number }>("SELECT sender_key, seq FROM seen_sequence")
    .then((rows) => {
      for (const row of rows) last.set(row.sender_key, row.seq);
    })
    .catch(() => undefined);

  // Writes go through in order, in the background: the number in memory is the truth for this run.
  let writes: Promise<unknown> = Promise.resolve();

  const seen: SeenSequences = {
    last: (senderKey) => last.get(senderKey),
    record(senderKey, seq) {
      const kept = last.get(senderKey);
      if (kept !== undefined && seq <= kept) return;
      last.set(senderKey, seq);
      writes = database
        .write(["seen"], (transaction) =>
          transaction.run("INSERT INTO seen_sequence (sender_key, seq) VALUES (?, ?) ON CONFLICT(sender_key) DO UPDATE SET seq = excluded.seq WHERE excluded.seq > seen_sequence.seq", [senderKey, seq]),
        )
        .catch(() => undefined);
    },
  };

  return { seen, ready, settled: () => writes };
}
