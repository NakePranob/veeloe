import { openDatabaseAsync } from "expo-sqlite";
import { createDatabase, migrate } from "./database";
import { MIGRATIONS } from "./migrations";

async function connect() {
  // The browser may clear this anyway, and the database is a cache there, so a refusal changes nothing (ADR 0021).
  if (process.env.EXPO_OS === "web") void navigator.storage?.persist?.().catch(() => undefined);
  return openDatabaseAsync("veeloe.db");
}

// On globalThis, not a module variable: Fast Refresh re-runs this module, and a fresh
// variable would open a second Database on the same native connection.
const held = globalThis as { veeloeDatabase?: Promise<ReturnType<typeof createDatabase>> | null };

/**
 * Once per JS runtime. expo-sqlite hands every open of the same file one native
 * connection, so a second Database (a remount of the root layout, a Fast Refresh)
 * would put a second queue on it and BEGIN inside the first one's transaction.
 */
export function openDatabase() {
  held.veeloeDatabase ??= (async () => {
    const connection = await connect();
    await migrate(connection, MIGRATIONS);
    return createDatabase(connection);
  })().catch((error) => {
    held.veeloeDatabase = null; // a failed open is tried again on retry
    throw error;
  });
  return held.veeloeDatabase;
}
