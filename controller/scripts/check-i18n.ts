// ADR 0065: Thai and English stay complete, slice by slice, and every key is read. Run by `bun run check`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { compareLanguages, unusedKeys } from "./check-i18n-rules";

const root = join(import.meta.dir, "../src");
const problems: string[] = [];

const languageFiles = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((path) => /(^|\/)(th|en)\.json$/.test(path));
const slices = [...new Set(languageFiles.map((path) => dirname(join(root, path))))];

// Which namespace each slice's words are, from src/app/i18n/resources.ts: `import { xI18n } from "../../pages/foo"` and `"ns": xI18n`.
const resources = readFileSync(join(root, "app/i18n/resources.ts"), "utf8");
const dirOf = new Map([...resources.matchAll(/import \{([^}]+)\} from "\.\.\/\.\.\/([^"]+)"/g)].flatMap(([, names, dir]) => names.split(",").map((name) => [name.trim(), dir] as const)));
const namespaceOf = new Map([...resources.matchAll(/^\s*"?([\w-]+)"?: (\w+I18n),$/gm)].map(([, namespace, name]) => [dirOf.get(name), namespace]));
const code = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));

for (const slice of slices) {
  const name = relative(root, slice);
  const [thPath, enPath] = [join(slice, "th.json"), join(slice, "en.json")];
  if (!existsSync(thPath) || !existsSync(enPath)) {
    problems.push(`${name}: needs both th.json and en.json`);
    continue;
  }
  const en = await Bun.file(enPath).json();
  for (const problem of compareLanguages(await Bun.file(thPath).json(), en)) problems.push(`${name}: ${problem}`);
  // Error words are keyed by the codes a Runtime or the Hub sends, not by the code here.
  if (name === "shared/i18n/errors") continue;
  // A slice's words are read in the slice, or wherever another slice opens its namespace.
  const sliceDir = dirname(name);
  const namespace = namespaceOf.get(sliceDir);
  if (!namespace) {
    problems.push(`${name}: no namespace in src/app/i18n/resources.ts`);
    continue;
  }
  const readers = code.filter(({ path, text }) => path.startsWith(`${sliceDir}/`) || text.includes(`useT("${namespace}")`)).map(({ text }) => text);
  for (const key of unusedKeys(en, readers)) problems.push(`${name}: ${key}: no code reads it`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n: ${slices.length} slices complete in th and en`);
