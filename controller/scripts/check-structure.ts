// The Controller's structure rules (ADR 0070): Feature-Sliced Design layers
// and slices, held by this check instead of Steiger. Each failure prints the
// rule id from .conventions/rules.json and the file, so it leads back to the
// decision. Only relative imports matter: the app has no path aliases.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

const root = join(import.meta.dir, "..");
const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"] as const;
const SLICED = new Set(["pages", "widgets", "features", "entities"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Generated or installed: never read.
const SKIP = new Set(["node_modules", "ios", "android", ".expo", "dist", "web-build", ".git"]);
// What may sit at the Controller root besides files.
const ROOT_DIRS = new Set(["app", "assets", "scripts", "src", ".conventions"]);

const failures: string[] = [];
const fail = (rule: string, file: string, detail: string) => failures.push(`${rule}: ${file}: ${detail}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(root, path).split(sep).join("/");
const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);

/** Where a path under src/ sits: its layer and, for a sliced layer or shared, its slice or segment. */
function place(path: string): { layer: string; slice?: string; rest: string[] } | null {
  const parts = rel(path).split("/");
  if (parts[0] !== "src" || !(LAYERS as readonly string[]).includes(parts[1])) return null;
  const layer = parts[1];
  if (layer === "app") return { layer, rest: parts.slice(2) };
  return { layer, slice: parts[2], rest: parts.slice(3) };
}

/** Every module specifier a file names: import, export … from, require(), import(), mock.module(). */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bmock\.module\s*\(\s*)["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** The slice (or shared segment) root a resolved import lands on, or a deep path into it. */
function isRoot(target: string, sliceDir: string): boolean {
  const t = normalize(target);
  return t === sliceDir || t === join(sliceDir, "index") || t === join(sliceDir, "index.ts") || t === join(sliceDir, "index.tsx");
}

const files = walk(root);

// known-places
for (const path of files) {
  const file = rel(path);
  const parts = file.split("/");
  if (parts.length === 1) continue; // a root file
  if (!ROOT_DIRS.has(parts[0])) {
    fail("known-places", file, `"${parts[0]}/" is not a known place`);
    continue;
  }
  if (parts[0] !== "src") continue;
  const layer = parts[1];
  if (!(LAYERS as readonly string[]).includes(layer)) {
    fail("known-places", file, `src/${layer}/ is not a layer`);
  } else if (layer !== "app" && parts.length < 4) {
    fail("known-places", file, `a file sits in src/${layer}/ outside any ${layer === "shared" ? "segment" : "slice"}`);
  }
}

// unit-shape: a slice's folders are those its templates have.
const rules = JSON.parse(readFileSync(join(root, ".conventions/rules.json"), "utf8"));
const allowed = new Set<string>();
for (const template of rules.templates as { dir: string }[]) {
  const dir = join(root, template.dir);
  if (!existsSync(dir)) {
    fail("unit-shape", template.dir, "the template folder is missing");
    continue;
  }
  for (const path of walk(dir)) {
    const folder = dirname(relative(dir, path)).split(sep).join("/");
    if (folder !== ".") allowed.add(folder);
  }
}
for (const path of files) {
  const where = place(path);
  if (!where || !SLICED.has(where.layer) || where.rest.length < 2) continue;
  const folder = where.rest.slice(0, -1).join("/");
  if (!allowed.has(folder)) {
    fail("unit-shape", rel(path), `src/${where.layer}/${where.slice}/${folder}/ is not a folder its templates have (${[...allowed].sort().join(", ")})`);
  }
}

// imports
for (const path of files) {
  if (!CODE.test(path)) continue;
  const file = rel(path);
  const parts = file.split("/");
  if (parts[0] !== "src" && parts[0] !== "app") continue;
  const from = place(path);
  for (const spec of specifiers(readFileSync(path, "utf8"))) {
    if (!spec.startsWith(".")) continue;
    const target = join(dirname(path), spec);
    const to = place(target);

    if (parts[0] === "app") {
      // A route re-exports a page; the root layout may take src/app.
      const ok = (to?.layer === "pages" && to.slice && isRoot(target, join(root, "src/pages", to.slice))) || (to?.layer === "app" && isRoot(target, join(root, "src/app"))) || (!to && !rel(target).startsWith("src/"));
      if (!ok) fail("routes-import-pages", file, `imports ${spec}; a route imports only src/pages/<name> or src/app`);
      continue;
    }
    if (!from || !to) continue;
    const rankFrom = LAYERS.indexOf(from.layer as (typeof LAYERS)[number]);
    const rankTo = LAYERS.indexOf(to.layer as (typeof LAYERS)[number]);
    if (rankTo < rankFrom) {
      fail("fsd-layer-direction", file, `${from.layer} imports ${to.layer} (${spec}); import only from layers below`);
      continue;
    }
    const sameSlice = from.layer === to.layer && (from.layer === "app" || from.slice === to.slice);
    if (sameSlice) continue;
    if (from.layer === to.layer && from.layer !== "shared") {
      fail("fsd-no-cross-slice", file, `${from.layer}/${from.slice} imports its sibling ${to.layer}/${to.slice} (${spec})`);
      continue;
    }
    if (from.layer === "shared") continue; // shared segments may use each other
    if (isTest(file)) continue;
    const sliceDir = to.layer === "app" ? join(root, "src/app") : join(root, "src", to.layer, to.slice!);
    if (!isRoot(target, sliceDir)) {
      fail("fsd-public-api", file, `imports ${spec}, a path inside ${rel(sliceDir)}; import its index.ts`);
    }
  }
}

// colour-from-shared-ui (ADR 0072): pages and widgets take colour from shared/ui only.
const colourRule = (rules.rules as { id: string; exceptions?: { path: string }[] }[]).find((rule) => rule.id === "colour-from-shared-ui");
const colourExempt = (colourRule?.exceptions ?? []).map((exception) => exception.path);
for (const path of files) {
  if (!CODE.test(path)) continue;
  const file = rel(path);
  const where = place(path);
  if (!where || (where.layer !== "pages" && where.layer !== "widgets") || isTest(file)) continue;
  if (colourExempt.some((prefix) => file.startsWith(prefix))) continue;
  const text = readFileSync(path, "utf8");
  if (/\buse(Colors|Shadows)\b/.test(text)) fail("colour-from-shared-ui", file, "uses useColors or useShadows; take colour from a shared/ui component");
  const hex = text.match(/["'`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})["'`]/);
  if (hex) fail("colour-from-shared-ui", file, `has the colour ${hex[0]}; colours live in shared/ui/theme.ts`);
}

if (failures.length > 0) {
  for (const line of failures) console.error(line);
  console.error(`\n${failures.length} structure problem(s). The rules: controller/.conventions/rules.json, ADR 0070.`);
  process.exit(1);
}
console.log("structure: ok");
