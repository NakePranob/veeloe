import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** What a file holds, or undefined when it is not there. A broken file throws. */
export function readJsonFile(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * Owner-only, and never half written: the new content goes to a temporary file
 * that replaces the old one in one step.
 */
export function writeJsonFile(file: string, value: unknown) {
  const temporary = `${file}.tmp`;
  rmSync(temporary, { force: true }); // an old one would keep its old mode
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}
