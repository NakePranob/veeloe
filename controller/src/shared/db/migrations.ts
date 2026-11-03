// Append only: see migrate().
export const MIGRATIONS = [
  `CREATE TABLE device_setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `CREATE TABLE machine (
    id TEXT PRIMARY KEY NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    hub_url TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    paired_at INTEGER NOT NULL
  )`,
] as const;
