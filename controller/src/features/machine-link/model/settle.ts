/** How long a save waits for the Machine's answer before the page lets it go. */
export const SAVE_ANSWER_MS = 15_000;

export type Settled = "waiting" | "landed" | "failed" | "expired";

/**
 * Where a save sent to the Machine stands (ADR 0006): landed once the Machine lists what went,
 * failed on its error, and let go when the Machine goes away or never answers, rather than locking the page.
 */
export function settle({ landed, error, online, age }: { landed: boolean; error: string | null; online: boolean | null; age: number }): Settled {
  if (landed) return "landed";
  if (error) return "failed";
  if (online === false || age >= SAVE_ANSWER_MS) return "expired";
  return "waiting";
}
