// Append only: see migrate().
export const MIGRATIONS = [`CREATE TABLE device_setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`] as const;
