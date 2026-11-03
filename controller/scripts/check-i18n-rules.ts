type Messages = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const VARIABLE = /\{\{\s*([^\s,}]+)/g;

/** Flat `a.b.c` keys with their text. A key's own dots, as in `hub.machine_offline`, stay. */
function flatten(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" && value !== null ? flatten(value as Messages, `${prefix}${key}.`) : ([[`${prefix}${key}`, String(value)]] as [string, string][]),
  );
}

/**
 * Key to the variables it uses. Plural forms fold into one key, because Thai has
 * only `_other` where English has `_one` and `_other`. `count` picks the form,
 * so one form may leave it out of its words, as in "One Agent".
 */
function summarize(messages: Messages): Map<string, Set<string>> {
  const summary = new Map<string, Set<string>>();
  for (const [key, text] of flatten(messages)) {
    const base = key.replace(PLURAL_SUFFIX, "");
    const variables = summary.get(base) ?? new Set<string>();
    for (const [, name] of text.matchAll(VARIABLE)) if (name !== "count") variables.add(name);
    summary.set(base, variables);
  }
  return summary;
}

/** What is wrong between the two languages of one slice; empty when they match. */
export function compareLanguages(th: Messages, en: Messages): string[] {
  const thai = summarize(th);
  const english = summarize(en);
  const problems: string[] = [];
  for (const key of english.keys()) if (!thai.has(key)) problems.push(`${key}: missing in th.json`);
  for (const key of thai.keys()) if (!english.has(key)) problems.push(`${key}: missing in en.json`);
  for (const [key, variables] of english) {
    const other = thai.get(key);
    if (other && [...variables].sort().join() !== [...other].sort().join()) problems.push(`${key}: variables differ, en {${[...variables].sort()}} th {${[...other].sort()}}`);
  }
  return problems;
}
