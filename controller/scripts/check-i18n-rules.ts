type Messages = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const VARIABLE = /\{\{\s*([^\s,}]+)/g;

/** Flat `a.b.c` keys with their text. A key's own dots, as in `hub.machine_offline`, stay. */
function flatten(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => (typeof value === "object" && value !== null ? flatten(value as Messages, `${prefix}${key}.`) : ([[`${prefix}${key}`, String(value)]] as [string, string][])));
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

/**
 * The keys of one slice that none of `sources` reads. A key is read when a string in the code
 * names it, or names an object above it (`t("parts", { returnObjects: true })`). A key built at
 * run time is read through the fixed start of its template, so `t(\`moods.${mood}\`)` reads every
 * `moods.*`, and so does a string ending in a dot. Plural forms read as their base key.
 * ponytail: any string counts, not only t()'s argument, so a key passed through a map or a prop
 * still reads; a key whose name is also some other string slips through.
 */
export function unusedKeys(messages: Messages, sources: string[]): string[] {
  const named = new Set<string>();
  const starts: string[] = [];
  for (const source of sources) {
    for (const [, double, single] of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
      const text = double ?? single;
      if (text.endsWith(".")) starts.push(text);
      else named.add(text);
    }
    for (const [, head] of source.matchAll(/`([^`$]*)\$\{/g)) if (head) starts.push(head);
  }
  const read = (key: string) => {
    const parts = key.split(".");
    for (let i = 1; i <= parts.length; i++) if (named.has(parts.slice(0, i).join("."))) return true;
    return starts.some((start) => key.startsWith(start));
  };
  return [...new Set(flatten(messages).map(([key]) => key.replace(PLURAL_SUFFIX, "")))].filter((key) => !read(key));
}
