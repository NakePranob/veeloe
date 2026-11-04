import { TaskEventKind, type TaskEvent } from "@veeloe/protocol";
import type { LlmRequest } from "./ports";

/**
 * What the LLM is sent, built from the log alone (ADR 0018). A Turn that never
 * ended, because its worker died, keeps the Member's words and drops the rest,
 * so no tool_use goes out without its result. The Turn running now counts as
 * ended. Consecutive user messages are fine: the Messages API joins them.
 *
 * ponytail: the whole Task every time. `memory-and-compaction` sends a summary instead (ADR 0041).
 */
export function conversation(events: TaskEvent[]): LlmRequest["messages"] {
  const ended = new Set<number>();
  let turn = 0;
  const turnOf = new Map<number, number>();
  for (const event of events) {
    if (event.kind === TaskEventKind.TurnStarted) turn = event.seq;
    turnOf.set(event.seq, turn);
    if (event.kind === TaskEventKind.TurnEnded) ended.add(turn);
  }
  ended.add(turn); // the one running now

  const messages: LlmRequest["messages"] = [];
  for (const event of events) {
    const body = event.body as { text?: string; content?: unknown[] };
    if (event.kind === TaskEventKind.MemberMessage) messages.push({ role: "user", content: [{ type: "text", text: body.text ?? "" }] });
    else if (!ended.has(turnOf.get(event.seq) ?? 0)) continue;
    else if (event.kind === TaskEventKind.LlmMessage) messages.push({ role: "assistant", content: body.content ?? [] });
    else if (event.kind === TaskEventKind.ToolResult) messages.push({ role: "user", content: body.content ?? [] });
  }
  return messages;
}
