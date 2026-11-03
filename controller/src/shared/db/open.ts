import { openDatabaseAsync } from "expo-sqlite";
import { createDatabase, migrate } from "./database";
import { MIGRATIONS } from "./migrations";

async function connect() {
  // The browser may clear this anyway, and the database is a cache there, so a refusal changes nothing (ADR 0021).
  if (process.env.EXPO_OS === "web") void navigator.storage?.persist?.().catch(() => undefined);
  return openDatabaseAsync("veeloe.db");
}

export async function openDatabase() {
  const connection = await connect();
  await migrate(connection, MIGRATIONS);
  return createDatabase(connection);
}
