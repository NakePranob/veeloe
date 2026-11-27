import type { ListedTrigger } from "@veeloe/protocol-ts";
import { useLanguage, useT } from "../../../shared/i18n";
import type { Colors } from "../../../shared/ui";
import type { LastOutcome } from "../model/schedule";

/** How each last round reads, and the colour of its dot: green told you something, orange needs a look. */
export const OUTCOME = {
  busy: { words: "last.busy", dot: "orange" },
  budget: { words: "last.budget", dot: "orange" },
  quiet: { words: "last.quiet", dot: "secondaryLabel" },
  done: { words: "last.done", dot: "green" },
  working: { words: "last.working", dot: "accent" },
  new: { words: "last.working", dot: "accent" },
  waiting: { words: "last.waiting", dot: "orange" },
  failed: { words: "last.failed", dot: "red" },
  interrupted: { words: "last.failed", dot: "red" },
  stuck: { words: "last.failed", dot: "red" },
  offline: { words: "last.done", dot: "secondaryLabel" },
} as const satisfies Record<LastOutcome, { words: string; dot: keyof Colors }>;

/** 2026-11-22 was a Sunday: the weekday names come from the device's own calendar, in its language. */
export const dayName = (day: number, language: string) => new Date(2026, 10, 22 + day).toLocaleDateString(language, { weekday: "long" });

/** When a round is next, short, in the device's language. */
export const whenShort = (at: number, language: string) => new Date(at).toLocaleString(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** The rhythm as one line: "every 15 minutes", "daily 09:00", "every Monday 08:30". */
export function useRhythm() {
  const t = useT("agent-schedule");
  const language = useLanguage();
  return ({ every, daily, weekly }: ListedTrigger["schedule"]) => {
    if (every) return t("rhythm.every", { minutes: every.minutes });
    if (weekly) return t("rhythm.weekly", { day: dayName(weekly.day, language), at: weekly.at });
    return t("rhythm.daily", { at: daily?.at ?? "" });
  };
}
