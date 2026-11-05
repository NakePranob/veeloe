import type { TaskEvent } from "@veeloe/protocol";
import type { FromWorker } from "../../ipc";

// The core's only ways out (ADR 0022): adapters implement these, tests fake them.

export interface Clock {
  now(): number;
}

/** A Task's log. Append only (ADR 0018): nothing here edits or deletes. */
export interface EventStore {
  starterOf(task: string): string | undefined;
  createTask(task: string, starter: string): void;
  /** Whether a Member's message with this id is already in any Task. */
  hasMessage(id: string): boolean;
  /** Writes the next event of the Task and returns it with its number. `messageId` makes a resent message a no-op. */
  append(task: string, kind: string, body: unknown, messageId?: string): TaskEvent;
  events(task: string, after?: number): TaskEvent[];
  /** The Tasks this Member started, with when each last moved. */
  tasksStartedBy(member: string): { id: string; updated: number }[];
}

/** `task` is the Task the request is for, which some Providers want as a session. */
export type LlmRequest = { task: string; system: string; messages: { role: "user" | "assistant"; content: unknown[] }[]; tools: ToolDefinition[] };
export type LlmReply = { content: unknown[]; stopReason: string | null };

/** Throws LlmError when there is no answer. */
export interface Llm {
  send(request: LlmRequest): Promise<LlmReply>;
}

export class LlmError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };

export interface ToolRunner {
  definitions(): ToolDefinition[];
  /** Runs one tool. A thrown error becomes an error result the LLM reads. */
  run(name: string, input: unknown): Promise<string>;
}

export interface SupervisorLink {
  send(message: FromWorker): void;
}
