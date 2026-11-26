import { isQuiet, statusOf, titleOf, type TaskStatus, type TaskSummary } from "./tasks";

/** Which Trigger a round came from, as its first `member.message` says (issue #56). */
type TriggerOrigin = { id: string; kind: string; at: number };

/** One round of a thread: its Task, when it was due, its name, and whether it had anything to say. */
type ThreadRound = { task: string; at: number; title: string; quiet: boolean; status: TaskStatus };

/** Every round of one Trigger (ADR 0061): only an index; the Tasks stay where they are. */
type Thread = { id: string; kind: string; agent: string; text: string; rounds: ThreadRound[] };

/** The Trigger a Task came from, or null for one a Member started. */
export function originOf(summary: Pick<TaskSummary, "first_body">): TriggerOrigin | null {
  try {
    const trigger = (JSON.parse(summary.first_body ?? "null") as { trigger?: { id?: unknown; kind?: unknown; at?: unknown } } | null)?.trigger;
    if (typeof trigger?.id !== "string" || typeof trigger.kind !== "string") return null;
    return { id: trigger.id, kind: trigger.kind, at: typeof trigger.at === "number" ? trigger.at : 0 };
  } catch {
    return null;
  }
}

const textOf = (summary: Pick<TaskSummary, "first_body">) => {
  try {
    const text = (JSON.parse(summary.first_body ?? "null") as { text?: unknown } | null)?.text;
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
};

/**
 * One thread per Trigger of this Agent, the newest round first in each and the thread with the newest
 * round first. `hidden` are threads deleted on this device; a quiet round stays in as "nothing" (ADR 0061).
 */
export function threadsOf(summaries: TaskSummary[], agent: string, hidden: ReadonlySet<string>, online: boolean | null): Thread[] {
  const threads = new Map<string, Thread>();
  for (const summary of summaries) {
    if (summary.agent_id !== agent) continue;
    const origin = originOf(summary);
    if (!origin || hidden.has(origin.id)) continue;
    const thread = threads.get(origin.id) ?? { id: origin.id, kind: origin.kind, agent, text: textOf(summary), rounds: [] };
    thread.rounds.push({ task: summary.id, at: origin.at || summary.updated_at, title: titleOf(summary), quiet: isQuiet(summary), status: statusOf(summary, online) });
    threads.set(origin.id, thread);
  }
  for (const thread of threads.values()) thread.rounds.sort((a, b) => b.at - a.at);
  return [...threads.values()].sort((a, b) => (b.rounds[0]?.at ?? 0) - (a.rounds[0]?.at ?? 0));
}
