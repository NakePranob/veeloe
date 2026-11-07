// What the supervisor and a worker say to each other over IPC (ADR 0020). It
// sits beside both because neither may import the other.
import type { ApprovalDecision, TaskEvent } from "@veeloe/protocol";

/** One HTTP request to the LLM, carried over IPC because the sandbox gives a worker no port to reach (ADR 0008, 0042). */
export type LlmRequest = { method: string; path: string; headers: Record<string, string>; body: string };
/** The Provider's whole answer, or the supervisor's refusal named in `x-veeloe-error`. */
export type LlmResponse = { status: number; headers: Record<string, string>; body: string };

export type ToWorker =
  /** A Member's message, already verified by the supervisor. `ref` is its envelope's sig, for errors. */
  | { kind: "message"; task: string; id: string; member: string; text: string; ref: string }
  /** The Task's events after `after`, for the Member asking. */
  | { kind: "sync"; task: string; after: number; member: string; ref: string }
  /** Which of this Agent's Tasks the Member may open: the ones they started (ADR 0060). */
  | { kind: "list"; member: string }
  /** A Member stops the Turn running in this Task: `ref` is its envelope, for errors (`stop-and-restart`). */
  | { kind: "stop"; task: string; id: string; member: string; ref: string }
  /** The Agent was renamed, its Allowlist or its Approval timeout changed: the next tool call uses all three. `allowlist` and `approvalTimeoutS` are missing from a supervisor older than `approval-and-allowlist`, read as empty and an hour (ADR 0023). */
  | { kind: "agent"; name: string; allowlist?: string[]; approvalTimeoutS?: number }
  | ({ kind: "llm.response"; id: string } & LlmResponse)
  /** The supervisor's answer to one waiting Approval: `ref` is the answer's envelope, for errors. `task` binds it to the Task that asked. */
  | { kind: "approval"; request: string; decision: ApprovalDecision; message?: string; member: string; ref: string; task?: string };

export type FromWorker =
  | { kind: "ready" }
  /** A new event, for the Member who started the Task. */
  | { kind: "event"; task: string; starter: string; event: TaskEvent }
  | { kind: "events"; task: string; member: string; events: TaskEvent[] }
  | { kind: "tasks"; member: string; tasks: { id: string; updated: number }[] }
  | { kind: "error"; member: string; ref: string; code: string; task?: string }
  | ({ kind: "llm.request"; id: string } & LlmRequest);
