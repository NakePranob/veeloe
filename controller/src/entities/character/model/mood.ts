import { TaskEventKind } from "@veeloe/protocol-ts";

// How the Agent's Character carries itself (CONTEXT.md): it follows the events, the LLM never picks it.
// It raises a hand while it waits on a person, and slumps when a Turn fails (controller-character).
// stuck is drawn but nothing sets it yet: the Runtime reports a stalled Turn in live-tool-output.
export type Mood = "idle" | "thinking" | "working" | "waiting" | "done" | "failed" | "stuck" | "offline";

/** An event as the database keeps it: its kind, and its body as JSON. */
export type StoredEvent = { kind: string; body: string | null };

const KNOWN: readonly string[] = Object.values(TaskEventKind);

function parse(body: string | null): Record<string, unknown> {
  try {
    const value = body ? JSON.parse(body) : null;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * From the latest event of a kind this build knows, and whether the Machine is online (null: not
 * known yet, which is not offline). A worker writes one order: the Member's message, turn.started, the
 * LLM's answers between tool results, an Approval while it waits, turn.ended. So the latest event says
 * what the Agent is doing, and an Approval waiting on a person is the one that raises the hand.
 */
export function moodOf(events: readonly StoredEvent[], online: boolean | null): Mood {
  if (online === false) return "offline";
  let last: StoredEvent | undefined;
  for (let i = events.length - 1; i >= 0 && !last; i--) if (KNOWN.includes(events[i]!.kind)) last = events[i];
  if (!last) return "idle";
  const body = parse(last.body);
  // An Approval waiting on a person: the hand goes up, and stays up until someone answers.
  if (last.kind === TaskEventKind.ApprovalRequested) return "waiting";
  // A Turn that failed slumps; one a person stopped, or the Machine restarted, just rests.
  if (last.kind === TaskEventKind.TurnEnded) return body.reason === "done" ? "done" : body.reason === "error" ? "failed" : "idle";
  if (last.kind === TaskEventKind.LlmMessage && Array.isArray(body.content) && body.content.some((block) => block?.type === "tool_use")) return "working";
  return "thinking";
}
