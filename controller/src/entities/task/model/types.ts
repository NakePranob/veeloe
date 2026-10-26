// A Task is an append-only log of numbered events (ADR 0018); everything a
// screen shows is worked out from it.
// ponytail: shaped here until the Protocol defines Task events (ADR 0023).
// How hard the Agent thinks on a Turn, sent with the Member's message.
export type Effort = "low" | "medium" | "high" | "max";

export type EventBody =
  | { type: "message"; text: string; effort?: Effort }
  | { type: "turn_start" }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; command: string }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "approval_request"; id: string; command: string; reason: string; expiresAt: number }
  | { type: "approval_answer"; id: string; approved: boolean }
  // A Member pressed Stop: the Turn ends here and files stay as they are (ADR 0017).
  | { type: "stop" }
  | { type: "turn_end" };

export type TaskEvent = EventBody & { seq: number; at: number };

export interface Task {
  id: string;
  agent: string;
  title: string;
  events: TaskEvent[];
}
