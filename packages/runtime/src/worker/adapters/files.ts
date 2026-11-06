import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ToolDefinition, ToolRunner } from "../core/ports";

export const READ_MAX_LINES = 2_000;
export const READ_MAX_BYTES = 256 * 1024;
export const READ_MAX_FILE = 10 * 1024 * 1024;
export const WRITE_MAX_BYTES = 2 * 1024 * 1024;
export const GLOB_MAX = 200;
export const GREP_MAX = 200;
export const GREP_MAX_FILE = 1024 * 1024;
export const PATTERN_MAX = 500;

const SKIPPED = new Set([".git", "node_modules"]);
const READ_DESCRIPTION = `Reads a file from your working folder and returns it with line numbers (line<TAB>text).
Use offset (first line, 1-based) and limit (how many lines, default ${READ_MAX_LINES}) for a large file. A file over ${READ_MAX_LINES} lines or ${READ_MAX_BYTES / 1024}KB comes back cut, with the number of lines left.`;
const WRITE_DESCRIPTION = `Writes a file in your working folder, replacing it whole and creating its folders. Up to ${WRITE_MAX_BYTES / 1024 / 1024}MB.`;
const EDIT_DESCRIPTION = `Replaces old_string with new_string in one file. old_string must appear exactly once, unless replace_all is true. Nothing is written when it appears zero or many times.`;
const GLOB_DESCRIPTION = `Finds files in your working folder by a glob pattern such as src/**/*.ts. Returns relative paths, at most ${GLOB_MAX}, skipping .git and node_modules.`;
const GREP_DESCRIPTION = `Searches files in your working folder with a regular expression and returns path:line: text, at most ${GREP_MAX} lines. include is a glob such as src/**/*.ts; files over 1MB and binary files are skipped.`;

export function fileTools({ workdir, readOnly = false }: { workdir: string; readOnly?: boolean }): ToolRunner {
  const definitions: ToolDefinition[] = [
    {
      name: "read",
      description: READ_DESCRIPTION,
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "A path inside your working folder, relative or absolute." },
          offset: { type: "number", description: "First line to return, 1-based. Default 1." },
          limit: { type: "number", description: `How many lines to return. Default and maximum ${READ_MAX_LINES}.` },
        },
        required: ["path"],
      },
    },
    {
      name: "glob",
      description: GLOB_DESCRIPTION,
      input_schema: {
        type: "object",
        properties: { pattern: { type: "string", description: "A glob pattern, for example src/**/*.ts." } },
        required: ["pattern"],
      },
    },
    {
      name: "grep",
      description: GREP_DESCRIPTION,
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "A JavaScript regular expression." },
          include: { type: "string", description: "Which files to search, as a glob. Default **/*." },
          ignore_case: { type: "boolean", description: "Match without regard to case." },
        },
        required: ["pattern"],
      },
    },
  ];
  if (!readOnly) {
    definitions.push(
      {
        name: "write",
        description: WRITE_DESCRIPTION,
        input_schema: {
          type: "object",
          properties: { path: { type: "string", description: "A path inside your working folder." }, content: { type: "string", description: "The whole new content of the file." } },
          required: ["path", "content"],
        },
      },
      {
        name: "edit",
        description: EDIT_DESCRIPTION,
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "A path inside your working folder." },
            old_string: { type: "string", description: "The exact text to replace." },
            new_string: { type: "string", description: "The text to put in its place." },
            replace_all: { type: "boolean", description: "Replace every occurrence instead of exactly one." },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    );
  }

  return {
    definitions: () => definitions,
    async run(name, input) {
      if (name === "read") return read(workdir, record(input));
      if (name === "glob") return glob(workdir, record(input));
      if (name === "grep") return grep(workdir, record(input));
      if (!readOnly && name === "write") return write(workdir, record(input));
      if (!readOnly && name === "edit") return edit(workdir, record(input));
      throw new Error(`there is no tool named ${name}`);
    },
  };
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

/** The real path of an existing file or folder, and never one outside the working folder. */
export function resolveInWorkdir(workdir: string, input: unknown): string {
  const target = insidePath(workdir, text(input, "path"));
  let real: string;
  try {
    real = realpathSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`no such file: ${String(input)}`);
    throw err;
  }
  if (!inside(workdir, real)) throw new Error(`path is outside the working folder: ${String(input)}`);
  return real;
}

/** Where a write may land: a path inside the working folder, with every existing part resolved. */
function resolveForWrite(workdir: string, input: unknown): string {
  const target = insidePath(workdir, text(input, "path"));
  // An existing target is written through its real path, so a symlink inside the folder keeps pointing at its file.
  if (existsSync(target)) {
    const real = realpathSync(target);
    if (!inside(workdir, real)) throw new Error(`path is outside the working folder: ${String(input)}`);
    return real;
  }
  const realAncestor = realpathSync(existingAncestor(target));
  if (!inside(workdir, realAncestor)) throw new Error(`path is outside the working folder: ${String(input)}`);
  return target;
}

function insidePath(workdir: string, input: string): string {
  const root = realpathSync(workdir);
  const raw = input.trim();
  const target = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  if (!inside(root, target)) throw new Error(`path is outside the working folder: ${input}`);
  return target;
}

function inside(workdir: string, candidate: string): boolean {
  return within(realpathSync(workdir), candidate);
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True only for a path whose real target is inside; a file that vanished mid-scan is skipped. */
function realInside(root: string, file: string): boolean {
  try {
    return within(root, realpathSync(file));
  } catch {
    return false;
  }
}

function existingAncestor(target: string): string {
  let dir = target;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no such folder: ${target}`);
    dir = parent;
  }
  return dir;
}

function read(workdir: string, input: Record<string, unknown>): string {
  const file = resolveInWorkdir(workdir, input.path);
  const stat = statSync(file);
  if (!stat.isFile()) throw new Error(`not a file: ${String(input.path)}`);
  if (stat.size > READ_MAX_FILE) throw new Error(`file is larger than ${READ_MAX_FILE / 1024 / 1024}MB; use grep or bash to inspect it`);
  const raw = readFileSync(file);
  if (raw.subarray(0, 8_192).includes(0)) throw new Error(`binary file: ${String(input.path)}`);

  const lines = raw.toString("utf8").split("\n");
  const start = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 1;
  const asked = Number.isInteger(input.limit) && (input.limit as number) > 0 ? Math.min(input.limit as number, READ_MAX_LINES) : READ_MAX_LINES;
  const chosen = lines.slice(start - 1, start - 1 + asked);
  const shown: string[] = [];
  let bytes = 0;
  for (let index = 0; index < chosen.length; index++) {
    const line = `${start + index}\t${chosen[index]}`;
    const size = Buffer.byteLength(line) + (shown.length > 0 ? 1 : 0);
    if (bytes + size > READ_MAX_BYTES) break;
    shown.push(line);
    bytes += size;
  }
  const left = Math.max(0, lines.length - (start - 1 + shown.length));
  const cutByBytes = shown.length < chosen.length;
  // Say what is left when a cap cut the answer, not when the caller asked for a short slice.
  if (left > 0 && (asked >= READ_MAX_LINES || cutByBytes)) return `${shown.join("\n")}\n[truncated: ${left} more lines; continue with offset ${start + shown.length}]`;
  return shown.join("\n");
}

function write(workdir: string, input: Record<string, unknown>): string {
  const target = resolveForWrite(workdir, input.path);
  if (typeof input.content !== "string") throw new Error("content is required");
  if (Buffer.byteLength(input.content) > WRITE_MAX_BYTES) throw new Error(`content is larger than ${WRITE_MAX_BYTES / 1024 / 1024}MB`);
  if (existsSync(target) && statSync(target).isDirectory()) throw new Error(`not a file: ${String(input.path)}`);
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
  mkdirSync(dirname(target), { recursive: true });
  writeAtomic(target, input.content, mode);
  return `Wrote ${Buffer.byteLength(input.content)} bytes to ${relative(realpathSync(workdir), target)}`;
}

function edit(workdir: string, input: Record<string, unknown>): string {
  const file = resolveInWorkdir(workdir, input.path);
  const oldString = text(input.old_string, "old_string");
  const newString = typeof input.new_string === "string" ? input.new_string : undefined;
  if (newString === undefined) throw new Error("new_string is required");
  const stat = statSync(file);
  if (stat.size > WRITE_MAX_BYTES) throw new Error(`file is larger than ${WRITE_MAX_BYTES / 1024 / 1024}MB; use write or bash for it`);
  const content = readFileSync(file, "utf8");

  let count = 0;
  for (let at = content.indexOf(oldString); at !== -1; at = content.indexOf(oldString, at + oldString.length)) count++;
  if (count === 0) throw new Error("old_string was found 0 times");
  if (count > 1 && !input.replace_all) throw new Error(`old_string was found ${count} times; make it unique or set replace_all`);
  const next = input.replace_all ? content.split(oldString).join(newString) : content.slice(0, content.indexOf(oldString)) + newString + content.slice(content.indexOf(oldString) + oldString.length);
  if (Buffer.byteLength(next) > WRITE_MAX_BYTES) throw new Error(`edited file would be larger than ${WRITE_MAX_BYTES / 1024 / 1024}MB`);
  const replaced = input.replace_all ? count : 1;
  writeAtomic(file, next, stat.mode & 0o777);
  return `Edited ${relative(realpathSync(workdir), file)}: replaced ${replaced} occurrence${replaced === 1 ? "" : "s"}`;
}

function glob(workdir: string, input: Record<string, unknown>): string {
  const pattern = patternOf(input.pattern);
  let scanner: Bun.Glob;
  try {
    scanner = new Bun.Glob(pattern);
  } catch {
    throw new Error(`invalid glob pattern: ${pattern}`);
  }
  const root = realpathSync(workdir);
  const found: string[] = [];
  try {
    for (const entry of scanner.scanSync({ cwd: root, dot: true, onlyFiles: true })) {
      if (skipped(entry)) continue;
      if (!realInside(root, join(root, entry))) continue;
      found.push(entry);
      if (found.length > GLOB_MAX) break;
    }
  } catch {
    throw new Error(`invalid glob pattern: ${pattern}`);
  }
  if (found.length === 0) return "no files matched";
  found.sort();
  const shown = found.slice(0, GLOB_MAX);
  return shown.join("\n") + (found.length > GLOB_MAX ? `\n[more files match; showing the first ${GLOB_MAX}]` : "");
}

function grep(workdir: string, input: Record<string, unknown>): string {
  const source = text(input.pattern, "pattern");
  if (source.length > PATTERN_MAX) throw new Error(`pattern is longer than ${PATTERN_MAX} characters`);
  let regex: RegExp;
  try {
    regex = new RegExp(source, input.ignore_case === true ? "i" : "");
  } catch {
    throw new Error(`invalid regular expression: ${source}`);
  }
  const include = input.include === undefined ? "**/*" : patternOf(input.include, "include");
  const root = realpathSync(workdir);
  const matches: string[] = [];
  let scanner: Bun.Glob;
  try {
    scanner = new Bun.Glob(include);
  } catch {
    throw new Error(`invalid include pattern: ${include}`);
  }
  try {
    for (const entry of scanner.scanSync({ cwd: root, dot: true, onlyFiles: true })) {
      if (skipped(entry)) continue;
      const file = join(root, entry);
      // The walker does not follow symlinks today, but grep reads whole files: never let one point outside.
      if (!realInside(root, file)) continue;
      const stat = statSync(file);
      if (stat.size > GREP_MAX_FILE) continue;
      const bytes = readFileSync(file);
      if (bytes.subarray(0, 8_192).includes(0)) continue;
      const lines = bytes.toString("utf8").split("\n");
      for (let index = 0; index < lines.length; index++) {
        if (!regex.test(lines[index]!)) continue;
        matches.push(`${entry}:${index + 1}: ${lines[index]}`);
        if (matches.length >= GREP_MAX) return matches.join("\n") + `\n[more matches; showing the first ${GREP_MAX}]`;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code) throw err;
    throw new Error(`invalid include pattern: ${include}`);
  }
  return matches.length === 0 ? "no matches" : matches.join("\n");
}

function patternOf(value: unknown, name = "pattern"): string {
  const pattern = text(value, name);
  if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) throw new Error(`${name} must stay inside the working folder: ${pattern}`);
  return pattern;
}

function skipped(entry: string): boolean {
  return entry.split("/").some((part) => SKIPPED.has(part));
}

function writeAtomic(file: string, content: string, mode: number) {
  const temporary = join(dirname(file), `${basename(file)}.tmp-${randomUUID()}`);
  try {
    writeFileSync(temporary, content, { mode });
    renameSync(temporary, file);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}
