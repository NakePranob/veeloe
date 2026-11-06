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
  `CREATE TABLE agent (
    id TEXT PRIMARY KEY NOT NULL,
    machine_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL
  );
  CREATE TABLE task (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    synced_seq INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX task_by_agent ON task (agent_id, updated_at);
  CREATE TABLE task_event (
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (task_id, seq)
  );
  CREATE TABLE pending_message (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sig TEXT,
    error TEXT
  )`,
  // The Machine's Egress as it last said, a JSON list of domains (`sandboxed-commands`).
  `ALTER TABLE machine ADD COLUMN egress TEXT NOT NULL DEFAULT '[]'`,
  // The Character the Machine keeps with the Agent, as JSON; null for one made before it had one.
  `ALTER TABLE agent ADD COLUMN character TEXT`,
  // The Member's Controllers, from the certificates the Hub hands over (`linking-and-revocation`).
  // linked_by is null for a key with no device.link: the first device.
  `CREATE TABLE device (
    key TEXT PRIMARY KEY NOT NULL,
    member_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    linked_by TEXT,
    linked_at INTEGER,
    revoked_at INTEGER
  )`,
  // The Agent's daily token Budget and today's tally, as the Machine last said (`daily-budget`, ADR 0043).
  // Null until a Machine that knows of them answers.
  `ALTER TABLE agent ADD COLUMN budget INTEGER;
  ALTER TABLE agent ADD COLUMN usage_day TEXT;
  ALTER TABLE agent ADD COLUMN usage_tokens INTEGER`,
  // Daily token totals the Machine answered with (`usage-history`, ADR 0066), and when it last answered.
  `CREATE TABLE usage_day (
    agent_id TEXT NOT NULL,
    day TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    PRIMARY KEY (agent_id, day)
  );
  ALTER TABLE machine ADD COLUMN usage_fetched_at INTEGER`,
] as const;
