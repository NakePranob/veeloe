// What the supervisor and a worker say to each other over IPC (ADR 0020). It
// sits beside both because neither may import the other.
import type { TaskEvent } from "@veeloe/protocol";

export type ToWorker =
  /** A Member's message, already verified by the supervisor. `ref` is its envelope's sig, for errors. */
  | { kind: "message"; task: string; id: string; member: string; text: string; ref: string }
  /** The Task's events after `after`, for the Member asking. */
  | { kind: "sync"; task: string; after: number; member: string; ref: string };

export type FromWorker =
  | { kind: "ready" }
  /** A new event, for the Member who started the Task. */
  | { kind: "event"; task: string; starter: string; event: TaskEvent }
  | { kind: "events"; task: string; member: string; events: TaskEvent[] }
  | { kind: "error"; member: string; ref: string; code: string; task?: string };
