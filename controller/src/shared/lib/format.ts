// Numbers and lists in the app's language (ADR 0065): the device's Intl does the separators and the words.

/** A count with the language's digit grouping, such as 128,000. */
export const formatNumber = (count: number, language: string) => new Intl.NumberFormat(language).format(count);

/** Tokens as the Budget screens show them: 2.4M, 300K, with the language's decimal sign. */
export function formatTokens(count: number, language: string) {
  if (count >= 1_000_000) return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1, useGrouping: false }).format(count / 1_000_000)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return `${count}`;
}

/** Names joined the way the language joins a list: "a, b and c", "a, b และ c". */
export const formatList = (items: readonly string[], language: string) => new Intl.ListFormat(language, { type: "conjunction" }).format(items);
