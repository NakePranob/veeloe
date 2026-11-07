import { useEffect, useState } from "react";

const DAY = 24 * 60 * 60 * 1000;

/**
 * When something last happened, as Mail shows it: the time today, else the date.
 * The device formats it in the Member's language, so there are no words to keep.
 */
export function when(at: number, language: string, now = Date.now()) {
  const date = new Date(at);
  if (now - at < DAY && date.getDate() === new Date(now).getDate()) return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(language, { day: "numeric", month: "short" });
}

/**
 * How long until this moment, for a countdown: `{ count, unit }`, so each language
 * chooses its own words and plural form (an Approval's expiry, ADR 0065).
 */
export function fromNow(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((at - now) / 60_000));
  return minutes < 60 ? { count: minutes, unit: "minute" as const } : { count: Math.max(1, Math.floor(minutes / 60)), unit: "hour" as const };
}

// The current time, refreshed often enough for a list's times to stay true while a screen is open.
export function useNow(every = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
