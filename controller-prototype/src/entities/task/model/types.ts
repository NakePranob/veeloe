// A Task is an append-only log of numbered events (ADR 0018); everything a
// screen shows is worked out from it.
// ponytail: shaped here until the Protocol defines Task events (ADR 0023).
// How hard the Agent thinks on a Turn, sent with the Member's message.
export type Effort = "low" | "medium" | "high" | "max";

export interface Attachment {
  name: string;
  // Bytes, declared with the hash in the signed message (ADR 0050).
  size: number;
}

export type EventBody =
  // `member`: who sent it, since a Turn runs on behalf of its sender (ADR 0010).
  | { type: "message"; text: string; effort?: Effort; member?: string; attachments?: Attachment[] }
  | { type: "turn_start" }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; command: string }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "approval_request"; id: string; command: string; reason: string; expiresAt: number }
  | { type: "approval_answer"; id: string; approved: boolean; member?: string }
  // A Member pressed Stop: the Turn ends here and files stay as they are (ADR 0017).
  | { type: "stop"; member?: string }
  // The worker or Runtime restarted mid-Turn: it ends like a Stop and never resumes itself (ADR 0033).
  | { type: "interrupted" }
  // The day's Budget ran out (ADR 0043).
  | { type: "budget_out" }
  | { type: "budget_restored" }
  // The Agent sent a file with send_file; the Controller fetches it when opened (ADR 0050).
  | { type: "file"; name: string; size: number; path: string }
  // The context was summarised for the LLM; the full log stays here (ADR 0041).
  | { type: "compaction" }
  // A Member with Approve opened the Task from an Approval, recorded in it (ADR 0060).
  | { type: "opened"; member: string }
  // A read-only question and its answer. They take no Turn of their own, so they can sit in
  // a Task while its Turn runs (ADR 0046).
  | { type: "ask"; id: string; text: string; to: string; member?: string }
  | { type: "ask_answer"; id: string; text: string; tools: string[]; refused?: boolean }
  | { type: "turn_end" };

export type TaskEvent = EventBody & { seq: number; at: number };

// Where a Task came from. Only "app" Tasks start visible to their starter alone (ADR 0060).
export type TaskSource = "app" | "schedule" | "idle" | "watch" | "channel" | "project";

export interface Task {
  id: string;
  agent: string;
  title: string;
  events: TaskEvent[];
  // Who started it (ADR 0010).
  starter: string;
  source: TaskSource;
  // The starter opened it to everyone with Use; this cannot be undone (ADR 0060).
  shared: boolean;
  // The Schedule, Watch or Idle Work list behind it, which groups it into a thread (ADR 0061).
  origin?: string;
  // The Project it belongs to, and the Task that delegated it (ADR 0045).
  project?: string;
  // The Team working on it; none when one Agent does (ADR 0064).
  team?: string;
  parent?: string;
  // This Task may use a Worktree (ADR 0047).
  worktree?: boolean;
  // A channel's Task is read-only in the app (ADR 0028).
  readOnly?: boolean;
  // Sequence numbers still in the Controller's outbox because the Machine is off (ADR 0021).
  outbox?: number[];
  // A scheduled round that had nothing to say stays out of the Inbox (ADR 0027).
  silent?: boolean;
}
