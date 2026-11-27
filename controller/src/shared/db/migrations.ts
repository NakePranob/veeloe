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
  // The Allowlist the Machine last sent, as JSON; null from a Machine older than `approval-and-allowlist`.
  // Appended last, never inserted before an older entry: `user_version` counts entries (`approval-and-allowlist`).
  `ALTER TABLE agent ADD COLUMN allowlist TEXT`,
  // How long one Approval waits, in seconds; null from a Machine older than `approval-and-allowlist`.
  `ALTER TABLE agent ADD COLUMN approval_timeout_s INTEGER`,
  // The last envelope number from each sender, so a replay after a restart is still refused
  // (`protocol-envelope`; the Runtime keeps its own in a file).
  `CREATE TABLE seen_sequence (sender_key TEXT PRIMARY KEY NOT NULL, seq INTEGER NOT NULL)`,
  // Agents deleted on the Machine that are still restorable, as `agent.listed` said (`agent-trash`).
  `CREATE TABLE agent_trash (
    id TEXT PRIMARY KEY NOT NULL,
    machine_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    restore_until INTEGER NOT NULL
  )`,
  // The deleted Agent's Character, as JSON, so the trash still shows who it was (`agent-trash`).
  `ALTER TABLE agent_trash ADD COLUMN character TEXT`,
  // Each Agent's own Egress as the Machine last said, a JSON list of domains; empty
  // for one from a Machine older than per-Agent Egress (`agent-egress-ui`).
  `ALTER TABLE agent ADD COLUMN egress TEXT NOT NULL DEFAULT '[]'`,
  // The GitHub repos the Agent may use through the git broker, as JSON; null from a
  // Machine older than the broker (issue #32).
  `ALTER TABLE agent ADD COLUMN git_repos TEXT`,
  // Threads of Trigger rounds deleted on this device (ADR 0061, issue #59): only the index goes,
  // the Tasks stay. Which Task belongs to which Trigger is read from its first message.
  `CREATE TABLE thread_hidden (trigger_id TEXT PRIMARY KEY NOT NULL)`,
  // What lists show of a Task, kept on its row as events land, so a list reads one row per Task
  // instead of searching each Task's events (task.ts, `REFRESH_SUMMARY`). Filled once here for the
  // Tasks already on the device; the kinds are the ones this build knew when it was written.
  `ALTER TABLE task ADD COLUMN events INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE task ADD COLUMN latest_kind TEXT;
  ALTER TABLE task ADD COLUMN latest_body TEXT;
  ALTER TABLE task ADD COLUMN last_kind TEXT;
  ALTER TABLE task ADD COLUMN last_body TEXT;
  ALTER TABLE task ADD COLUMN title_body TEXT;
  ALTER TABLE task ADD COLUMN first_body TEXT;
  ALTER TABLE task ADD COLUMN trigger_id TEXT;
  ALTER TABLE task ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0;
  UPDATE task SET
    events = (SELECT count(*) FROM task_event e WHERE e.task_id = task.id),
    latest_kind = (SELECT kind FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'turn.started', 'llm.message', 'tool.result', 'turn.ended', 'turn.stopped', 'turn.interrupted', 'turn.stalled', 'approval.requested', 'approval.answered') ORDER BY seq DESC LIMIT 1),
    latest_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'turn.started', 'llm.message', 'tool.result', 'turn.ended', 'turn.stopped', 'turn.interrupted', 'turn.stalled', 'approval.requested', 'approval.answered') ORDER BY seq DESC LIMIT 1),
    last_kind = (SELECT kind FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1),
    last_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind IN ('member.message', 'llm.message') ORDER BY seq DESC LIMIT 1),
    title_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind = 'task.titled' ORDER BY seq DESC LIMIT 1),
    first_body = (SELECT body FROM task_event e WHERE e.task_id = task.id AND kind = 'member.message' ORDER BY seq LIMIT 1);
  UPDATE task SET
    trigger_id = json_extract(first_body, '$.trigger.id'),
    quiet = coalesce(latest_kind = 'turn.ended' AND json_extract(latest_body, '$.reason') = 'quiet', 0);
  CREATE INDEX task_by_agent_news ON task (agent_id, quiet, updated_at);
  CREATE INDEX task_by_trigger ON task (trigger_id, updated_at);`,
] as const;
