import { SCHEDULE_MAX_MINUTES, SCHEDULE_MIN_MINUTES, TRIGGER_GOAL_MAX, TRIGGER_TEXT_MAX, type ListedTrigger, type Schedule, type Trigger } from "@veeloe/protocol-ts";
import type { TaskStatus } from "../../../entities/task";

export type Mode = "every" | "daily" | "weekly";

/** What the form holds while a Member writes a Schedule: minutes stay text until it is checked. */
/** `goal` is one sentence of what counts as done (ADR 0085); empty for a Schedule that just runs. */
export type Draft = { text: string; goal: string; mode: Mode; minutes: string; at: string; day: number };

export const EMPTY_DRAFT: Draft = { text: "", goal: "", mode: "daily", minutes: "60", at: "09:00", day: 1 };

export type Problem = "empty" | "tooOften" | "badTime";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The structure the Machine runs by, or why the Protocol would refuse it (issue #56). */
export function scheduleOf(draft: Draft): Schedule | Problem {
  if (draft.mode === "every") {
    const minutes = Number(draft.minutes);
    if (!Number.isInteger(minutes) || minutes < SCHEDULE_MIN_MINUTES || minutes > SCHEDULE_MAX_MINUTES) return "tooOften";
    return { every: { minutes } };
  }
  if (!CLOCK.test(draft.at)) return "badTime";
  return draft.mode === "daily" ? { daily: { at: draft.at } } : { weekly: { day: draft.day, at: draft.at } };
}

/**
 * The Trigger a save signs; `id` stays the same when one is edited, so the Machine replaces it whole.
 * `allow` is the scope as the Machine holds it when the Member saves, not when the form opened, so a scope
 * added from a Task meanwhile is kept (ADR 0079).
 */
export function triggerOf(draft: Draft, id: string, allow: readonly string[] = []): Trigger | Problem {
  const text = draft.text.trim();
  if (!text || text.length > TRIGGER_TEXT_MAX) return "empty";
  const schedule = scheduleOf(draft);
  if (typeof schedule === "string") return schedule;
  const goal = draft.goal.trim().slice(0, TRIGGER_GOAL_MAX);
  return { id, kind: "schedule", text, schedule, ...(goal && { goal }), ...(allow.length > 0 && { allow: [...allow] }) };
}

/** An existing Schedule opened for editing. */
export function draftOf(trigger: Trigger): Draft {
  const { every, daily, weekly } = trigger.schedule ?? {};
  const kept = { ...EMPTY_DRAFT, text: trigger.text, goal: trigger.goal ?? "" };
  if (every) return { ...kept, mode: "every", minutes: String(every.minutes) };
  if (weekly) return { ...kept, mode: "weekly", day: weekly.day, at: weekly.at };
  return { ...kept, mode: "daily", at: daily?.at ?? EMPTY_DRAFT.at };
}

/** How the last round went, as the card says it: a skip, a quiet one, or the Task's own status. */
export type LastOutcome = "busy" | "budget" | "quiet" | TaskStatus;

/** The newest round the Machine skipped or this device holds a Task of, whichever came later. */
export function lastRoundOf(trigger: Pick<ListedTrigger, "lastSkip">, round: { task: string; at: number; quiet: boolean; status: TaskStatus } | undefined): { at: number; outcome: LastOutcome; task?: string } | null {
  const skip = trigger.lastSkip;
  if (skip && (!round || skip.at > round.at)) return { at: skip.at, outcome: skip.why };
  if (!round) return null;
  return { at: round.at, outcome: round.quiet ? "quiet" : round.status, task: round.task };
}

/** The rhythms the "every" picker offers, in minutes; a Schedule set to another number still shows its own. */
const EVERY_CHOICES = [15, 30, 60, 120, 180, 360, 720] as const;

/** The minutes of an hour the time picker offers. */
const MINUTE_CHOICES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"] as const;

/** The "every" choices with this draft's own number among them, in order. */
export const everyChoices = (minutes: string) => [...new Set([...EVERY_CHOICES.map(String), minutes])].sort((a, b) => Number(a) - Number(b));

/** The minute choices with this time's own minute among them, in order. */
export const minuteChoices = (at: string) => [...new Set([...MINUTE_CHOICES, at.slice(3, 5)])].sort();
