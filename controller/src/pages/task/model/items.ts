import type { TaskEvent } from "../../../entities/task";

export type ToolCall = Extract<TaskEvent, { type: "tool_call" }>;

export type Item = { kind: "event"; event: TaskEvent } | { kind: "tools"; calls: ToolCall[] };

// Results join their call, and Turn boundaries and answers show through the
// Approval card, so none of them gets a row of its own.
const HIDDEN: TaskEvent["type"][] = ["tool_result", "turn_start", "turn_end", "approval_answer"];

// What the Task screen draws, in order: commands run back to back fold into one item.
export function items(events: TaskEvent[]): Item[] {
  const out: Item[] = [];
  for (const event of events) {
    if (HIDDEN.includes(event.type)) continue;
    const last = out.at(-1);
    if (event.type === "tool_call" && last?.kind === "tools") last.calls.push(event);
    else if (event.type === "tool_call") out.push({ kind: "tools", calls: [event] });
    else out.push({ kind: "event", event });
  }
  return out;
}
