import { SCHEDULE_MAX_MINUTES, SCHEDULE_MIN_MINUTES, TRIGGER_TEXT_MAX, type Schedule, type Trigger } from "@veeloe/protocol-ts";

export type Mode = "every" | "daily" | "weekly";

/** What the form holds while a Member writes a Schedule: minutes stay text until it is checked. */
export type Draft = { text: string; mode: Mode; minutes: string; at: string; day: number };

export const EMPTY_DRAFT: Draft = { text: "", mode: "daily", minutes: "60", at: "09:00", day: 1 };

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

/** The Trigger a save signs; `id` stays the same when one is edited, so the Machine replaces it whole. */
export function triggerOf(draft: Draft, id: string): Trigger | Problem {
  const text = draft.text.trim();
  if (!text || text.length > TRIGGER_TEXT_MAX) return "empty";
  const schedule = scheduleOf(draft);
  if (typeof schedule === "string") return schedule;
  return { id, kind: "schedule", text, schedule };
}

/** An existing Schedule opened for editing. */
export function draftOf(trigger: Trigger): Draft {
  const { every, daily, weekly } = trigger.schedule;
  if (every) return { ...EMPTY_DRAFT, text: trigger.text, mode: "every", minutes: String(every.minutes) };
  if (weekly) return { ...EMPTY_DRAFT, text: trigger.text, mode: "weekly", day: weekly.day, at: weekly.at };
  return { ...EMPTY_DRAFT, text: trigger.text, mode: "daily", at: daily?.at ?? EMPTY_DRAFT.at };
}
