/** What the Budget field means: millions of tokens a day, and whether it may be sent at all. */
export function budgetOf(text: string): { tokens: number; valid: boolean } {
  const tokens = Math.round(Number(text.trim().replace(",", ".")) * 1_000_000);
  // The protocol takes a whole number from 1 to 10^12 (`daily-budget`); anything else is not sent.
  return { tokens, valid: text.trim() !== "" && Number.isFinite(tokens) && tokens > 0 && tokens <= 1_000_000_000_000 };
}
