import { TaskEventKind } from "@veeloe/protocol";

// How the Agent's Character carries itself (CONTEXT.md): it follows the events, the LLM never picks it.
// ponytail: five of the prototype's six; "waiting" comes with Approval events (approval-and-allowlist).
export type Mood = "idle" | "thinking" | "working" | "done" | "offline";

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
 * LLM's answers between tool results, turn.ended. So the latest event says as much as the whole log
 * until Approvals can sit between the others.
 */
export function moodOf(events: readonly StoredEvent[], online: boolean | null): Mood {
  if (online === false) return "offline";
  let last: StoredEvent | undefined;
  for (let i = events.length - 1; i >= 0 && !last; i--) if (KNOWN.includes(events[i]!.kind)) last = events[i];
  if (!last) return "idle";
  const body = parse(last.body);
  // A Turn that failed has nothing to celebrate.
  if (last.kind === TaskEventKind.TurnEnded) return body.reason === "done" ? "done" : "idle";
  if (last.kind === TaskEventKind.LlmMessage && Array.isArray(body.content) && body.content.some((block) => block?.type === "tool_use")) return "working";
  return "thinking";
}
