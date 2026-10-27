import { plainFirstLine } from "../../../shared/lib";
import type { TaskEvent } from "./types";

// Everything a screen shows about a Task is worked out here from its event log
// (ADR 0018), once, so no two screens can disagree.

export type TaskState = "waiting" | "working" | "done";

// What a Member sees for an Agent's Task: its state, or offline when its Machine is.
export type Status = TaskState | "offline";

export const STATUS_LABEL: Record<Status, string> = { waiting: "รอคุณอนุมัติ", working: "กำลังทำงาน", done: "เสร็จแล้ว", offline: "ออฟไลน์" };

type Request = Extract<TaskEvent, { type: "approval_request" }>;

function lastIndex(events: TaskEvent[], types: TaskEvent["type"][]) {
  for (let i = events.length - 1; i >= 0; i--) if (types.includes(events[i].type)) return i;
  return -1;
}

const isTurnEnd = (event: TaskEvent) => event.type === "turn_end" || event.type === "stop";

export function turnOpen(events: TaskEvent[]) {
  return lastIndex(events, ["turn_start"]) > lastIndex(events, ["turn_end", "stop"]);
}

// open: waiting for an answer. expired: nobody answered in time, which counts
// as denied (CONTEXT.md). closed: its Turn ended first, by Stop or a steer.
export type ApprovalStatus = "open" | "approved" | "denied" | "expired" | "closed";

export function approvals(events: TaskEvent[], now = Date.now()): Map<string, ApprovalStatus> {
  const status = new Map<string, ApprovalStatus>();
  const unanswered = new Set<string>();
  for (const event of events) {
    if (event.type === "approval_request") {
      status.set(event.id, event.expiresAt > now ? "open" : "expired");
      unanswered.add(event.id);
    }
    if (event.type === "approval_answer" && unanswered.delete(event.id)) status.set(event.id, event.approved ? "approved" : "denied");
    if (isTurnEnd(event)) {
      for (const id of unanswered) if (status.get(id) === "open") status.set(id, "closed");
      unanswered.clear();
    }
  }
  return status;
}

export function pendingApproval(events: TaskEvent[], now = Date.now()): Request | undefined {
  const status = approvals(events, now);
  return events.find((event): event is Request => event.type === "approval_request" && status.get(event.id) === "open");
}

// `stopped`: the Turn ended (Stop) before the command reported back.
export interface ToolResult {
  ok: boolean;
  output: string;
  stopped?: boolean;
}

export function toolResults(events: TaskEvent[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  const running = new Set<string>();
  for (const event of events) {
    if (event.type === "tool_call") running.add(event.id);
    if (event.type === "tool_result" && running.delete(event.id)) results.set(event.id, { ok: event.ok, output: event.output });
    if (isTurnEnd(event)) {
      running.forEach((id) => results.set(id, { ok: false, output: "หยุดก่อนเสร็จ", stopped: true }));
      running.clear();
    }
  }
  return results;
}

export function stateOf(events: TaskEvent[], now = Date.now()): TaskState {
  if (pendingApproval(events, now)) return "waiting";
  return turnOpen(events) ? "working" : "done";
}

export function statusOf(events: TaskEvent[], online: boolean, now = Date.now()): Status {
  return online ? stateOf(events, now) : "offline";
}

// How the Agent's Character carries itself (CONTEXT.md): it follows the events, the LLM never picks it.
// ponytail: the six today's events tell apart; "delegating" and "stuck" wait for Delegation events and a
// Turn that can end in error.
export type Mood = "idle" | "thinking" | "working" | "waiting" | "done" | "offline";

export function moodOf(events: TaskEvent[], online: boolean, now = Date.now()): Mood {
  if (!online) return "offline";
  if (pendingApproval(events, now)) return "waiting";
  const start = lastIndex(events, ["turn_start"]);
  if (turnOpen(events)) {
    const results = toolResults(events);
    return events.slice(start).some((event) => event.type === "tool_call" && !results.has(event.id)) ? "working" : "thinking";
  }
  // A Turn the Member stopped has nothing new to show them.
  return start < 0 || lastIndex(events, ["stop"]) > start ? "idle" : "done";
}

// Messages sent during a Turn wait for it to end before the Agent reads them.
export function queued(events: TaskEvent[]): Set<number> {
  if (!turnOpen(events)) return new Set();
  const start = lastIndex(events, ["turn_start"]);
  return new Set(events.flatMap((event, i) => (i > start && event.type === "message" ? [event.seq] : [])));
}

// The line under the Agent's name in the inbox.
export function preview(events: TaskEvent[], now = Date.now()) {
  const pending = pendingApproval(events, now);
  if (pending) return pending.command;
  const last = events[lastIndex(events, ["text", "message", "tool_call", "stop"])];
  if (last?.type === "tool_call") return last.command;
  if (last?.type === "stop") return "คุณหยุด Turn นี้";
  if (last?.type === "text" || last?.type === "message") return plainFirstLine(last.text);
  return "";
}

export function lastActivity(events: TaskEvent[]) {
  return events.at(-1)?.at ?? 0;
}
