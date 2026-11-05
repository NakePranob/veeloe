// What the supervisor and a worker say to each other over IPC (ADR 0020). It
// sits beside both because neither may import the other.
import type { TaskEvent } from "@veeloe/protocol";

/** One HTTP request to the LLM, carried over IPC because the sandbox gives a worker no port to reach (ADR 0008, 0042). */
export type LlmRequest = { method: string; path: string; headers: Record<string, string>; body: string };
/** The Provider's whole answer, or the supervisor's refusal named in `x-veeloe-error`. */
export type LlmResponse = { status: number; headers: Record<string, string>; body: string };

export type ToWorker =
  /** A Member's message, already verified by the supervisor. `ref` is its envelope's sig, for errors. */
  | { kind: "message"; task: string; id: string; member: string; text: string; ref: string }
  /** The Task's events after `after`, for the Member asking. */
  | { kind: "sync"; task: string; after: number; member: string; ref: string }
  | ({ kind: "llm.response"; id: string } & LlmResponse);

export type FromWorker =
  | { kind: "ready" }
  /** A new event, for the Member who started the Task. */
  | { kind: "event"; task: string; starter: string; event: TaskEvent }
  | { kind: "events"; task: string; member: string; events: TaskEvent[] }
  | { kind: "error"; member: string; ref: string; code: string; task?: string }
  | ({ kind: "llm.request"; id: string } & LlmRequest);
