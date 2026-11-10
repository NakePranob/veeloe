import { z } from "zod";
import { AgentIdSchema } from "./agent";

const agent = AgentIdSchema;

/** Controller → Machine, with the Task's id in the header. `id` makes a resend harmless. */
export const TaskMessageBodySchema = z.looseObject({
  agent,
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(100_000),
  attachments: z.array(z.looseObject({ name: z.string().min(1).max(200), size: z.number().int().positive(), hash: z.string().min(1).max(128) })).max(10).optional(),
});
export type TaskMessageBody = z.infer<typeof TaskMessageBodySchema>;

/** One base64url chunk of a Task attachment (ADR 0050); `file` is the whole file's hash. */
export const FileChunkBodySchema = z.looseObject({
  file: z.string().min(1).max(128),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  data: z.string().min(1),
});
export type FileChunkBody = z.infer<typeof FileChunkBodySchema>;

/**
 * Controller → Machine, with the Task's id in the header: stop the Turn running
 * now (`stop-and-restart`, ADR 0017). `id` makes a resend stop nothing twice.
 */
export const TaskStopBodySchema = z.looseObject({
  agent,
  id: z.string().min(1).max(64),
});
export type TaskStopBody = z.infer<typeof TaskStopBodySchema>;

/**
 * One event of a Task's log (ADR 0018). `kind` stays open: a newer Runtime adds
 * kinds, and a Controller skips the ones it does not know (ADR 0023).
 */
export const TaskEventSchema = z.looseObject({
  seq: z.number().int().positive(),
  kind: z.string().min(1),
  /** Unix milliseconds on the Machine. */
  at: z.number().int().nonnegative(),
  body: z.unknown(),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;

/** Machine → Member: a new event, with the Task's id in the header. */
export const TaskEventBodySchema = TaskEventSchema.extend({ agent });
export type TaskEventBody = z.infer<typeof TaskEventBodySchema>;

/** Controller → Machine: the Task's events after `after`. */
export const TaskSyncBodySchema = z.looseObject({ agent, after: z.number().int().nonnegative() });
export type TaskSyncBody = z.infer<typeof TaskSyncBodySchema>;

/** Machine → Member: events in order, up to TASK_EVENTS_PAGE at a time. */
export const TaskEventsBodySchema = z.looseObject({ agent, events: z.array(TaskEventSchema) });
export type TaskEventsBody = z.infer<typeof TaskEventsBodySchema>;

export const TASK_EVENTS_PAGE = 100;

/** Controller → Machine: which Tasks this Member may open (ADR 0060), for a device that has none of them yet. */
export const TaskListBodySchema = z.looseObject({});

/** Machine → Member: one Agent's Tasks at a time. `updated` is Unix milliseconds on the Machine. */
export const TaskListedBodySchema = z.looseObject({
  tasks: z.array(z.looseObject({ id: z.string().min(1).max(64), agent, updated: z.number().int().nonnegative() })),
});
export type TaskListedBody = z.infer<typeof TaskListedBodySchema>;

/** What `body` holds for the kinds v0.1 writes. */
export const TaskEventKind = {
  /** `{ member, id, text }` */
  MemberMessage: "member.message",
  /** `{ member }` */
  TurnStarted: "turn.started",
  /** `{ content }`, exactly as the LLM sent it, thinking blocks included. */
  LlmMessage: "llm.message",
  /** `{ content }`: the tool_result blocks that answer the LLM's tool_use. */
  ToolResult: "tool.result",
  /** `{ reason: "done" } | { reason: "error", code } | { reason: "stopped" } | { reason: "interrupted" }` */
  TurnEnded: "turn.ended",
  /** `{ member }`: who stopped the Turn that was running (`stop-and-restart`). */
  TurnStopped: "turn.stopped",
  /** `{ reason: "restart" }`: the worker started again with this Turn still open (ADR 0033). */
  TurnInterrupted: "turn.interrupted",
  /** `{ request, command, parts, expiresAt }`: the worker asks for an Approval and waits. */
  ApprovalRequested: "approval.requested",
  /** `{ request, member, decision, message? }`: who answered and how. */
  ApprovalAnswered: "approval.answered",
} as const;
