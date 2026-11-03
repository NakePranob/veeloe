// ADR 0065: Thai and English stay complete, slice by slice. Run by `bun run check`.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { compareLanguages } from "./check-i18n-rules";

const root = join(import.meta.dir, "../src");
const problems: string[] = [];

const languageFiles = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((path) => /(^|\/)(th|en)\.json$/.test(path));
const slices = [...new Set(languageFiles.map((path) => dirname(join(root, path))))];

for (const slice of slices) {
  const name = relative(root, slice);
  const [thPath, enPath] = [join(slice, "th.json"), join(slice, "en.json")];
  if (!existsSync(thPath) || !existsSync(enPath)) {
    problems.push(`${name}: needs both th.json and en.json`);
    continue;
  }
  for (const problem of compareLanguages(await Bun.file(thPath).json(), await Bun.file(enPath).json())) problems.push(`${name}: ${problem}`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n: ${slices.length} slices complete in th and en`);
