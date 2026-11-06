import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTools } from "./files";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup() {
  const root = mkdtempSync(join(tmpdir(), "veeloe-files-"));
  const workdir = join(root, "workdir");
  mkdirSync(workdir);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const tools = fileTools({ workdir });
  return { root, workdir, tools, run: (name: string, input: unknown) => tools.run(name, input) };
}

test("a path is relative to the Workdir or absolute inside it, and never outside", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "a.txt"), "hello");
  expect(await s.run("read", { path: "a.txt" })).toContain("1\thello");
  expect(await s.run("read", { path: join(s.workdir, "a.txt") })).toContain("1\thello");
  await expect(s.run("read", { path: "../a.txt" })).rejects.toThrow(/outside/);
  await expect(s.run("read", { path: "/etc/hosts" })).rejects.toThrow(/outside/);
});

test("a symlink that leaves the Workdir is refused for reading and writing", async () => {
  const s = setup();
  const outside = mkdtempSync(join(tmpdir(), "veeloe-outside-"));
  cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(join(outside, "secret.txt"), join(s.workdir, "link.txt"));
  symlinkSync(outside, join(s.workdir, "outside-folder"));
  await expect(s.run("read", { path: "link.txt" })).rejects.toThrow(/outside/);
  await expect(s.run("write", { path: "link.txt", content: "changed" })).rejects.toThrow(/outside/);
  await expect(s.run("write", { path: "outside-folder/new.txt", content: "x" })).rejects.toThrow(/outside/);
  expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("secret");
});

test("glob and grep skip a symlink that leaves the Workdir", async () => {
  const s = setup();
  const outside = mkdtempSync(join(tmpdir(), "veeloe-outside-"));
  cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "leak.ts"), "NEEDLE");
  symlinkSync(join(outside, "leak.ts"), join(s.workdir, "leak.ts"));
  expect(await s.run("glob", { pattern: "**/*.ts" })).not.toContain("leak.ts");
  expect(await s.run("grep", { pattern: "NEEDLE" })).toBe("no matches");
});

test("read numbers the lines and can take a slice", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "short.txt"), "a\nb\nc");
  expect(await s.run("read", { path: "short.txt" })).toBe("1\ta\n2\tb\n3\tc");
  writeFileSync(join(s.workdir, "ten.txt"), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
  expect(await s.run("read", { path: "ten.txt", offset: 3, limit: 2 })).toBe("3\tline 3\n4\tline 4");
});

test("read cuts a long file and says how many lines are left", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "long.txt"), Array.from({ length: 5_000 }, (_, i) => `line ${i + 1}`).join("\n"));
  const result = await s.run("read", { path: "long.txt" });
  expect(result.split("\n")).toHaveLength(2_001);
  expect(result.split("\n")[2_000]).toContain("truncated");
  expect(result).toContain("3000 more lines; continue with offset 2001");
});

test("read stops at 256KB of text and says where to continue", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "wide.txt"), Array.from({ length: 100 }, (_, i) => `line ${i + 1} ${"x".repeat(5_000)}`).join("\n"));
  const result = await s.run("read", { path: "wide.txt" });
  const text = result.split("\n[truncated:")[0]!;
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(256 * 1024);
  expect(result).toContain("more lines; continue with offset");
});

test("read refuses a binary file, a missing file and one over 10MB", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "binary.bin"), Buffer.from([0x41, 0x00, 0x42]));
  await expect(s.run("read", { path: "binary.bin" })).rejects.toThrow(/binary/);
  await expect(s.run("read", { path: "missing.txt" })).rejects.toThrow(/no such file/);
  writeFileSync(join(s.workdir, "huge.bin"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x41));
  await expect(s.run("read", { path: "huge.bin" })).rejects.toThrow(/larger than 10MB/);
});

test("write creates folders, overwrites atomically and keeps an existing file's mode", async () => {
  const s = setup();
  expect(await s.run("write", { path: "a/b/c.txt", content: "hello" })).toContain("Wrote 5 bytes");
  expect(readFileSync(join(s.workdir, "a/b/c.txt"), "utf8")).toBe("hello");
  expect(readdirSync(join(s.workdir, "a/b")).some((name) => name.includes(".tmp-"))).toBe(false);

  writeFileSync(join(s.workdir, "mode.txt"), "old", { mode: 0o640 });
  const mode = statSync(join(s.workdir, "mode.txt")).mode & 0o777;
  await s.run("write", { path: "mode.txt", content: "new" });
  expect(readFileSync(join(s.workdir, "mode.txt"), "utf8")).toBe("new");
  expect(statSync(join(s.workdir, "mode.txt")).mode & 0o777).toBe(mode);
});

test("write refuses too much content, a folder and a path outside", async () => {
  const s = setup();
  await expect(s.run("write", { path: "big.txt", content: "x".repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/larger than 2MB/);
  mkdirSync(join(s.workdir, "folder"));
  await expect(s.run("write", { path: "folder", content: "x" })).rejects.toThrow(/not a file/);
  await expect(s.run("write", { path: "../escape.txt", content: "x" })).rejects.toThrow(/outside/);
});

test("edit replaces exactly one occurrence and keeps the file's mode", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "one.txt"), "hello world", { mode: 0o640 });
  const mode = statSync(join(s.workdir, "one.txt")).mode & 0o777;
  expect(await s.run("edit", { path: "one.txt", old_string: "hello", new_string: "hi" })).toContain("replaced 1 occurrence");
  expect(readFileSync(join(s.workdir, "one.txt"), "utf8")).toBe("hi world");
  expect(statSync(join(s.workdir, "one.txt")).mode & 0o777).toBe(mode);
});

test("edit writes nothing when the text is missing or appears many times, and can replace all", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "many.txt"), "a a a");
  await expect(s.run("edit", { path: "many.txt", old_string: "zzz", new_string: "b" })).rejects.toThrow(/0 times/);
  await expect(s.run("edit", { path: "many.txt", old_string: "a", new_string: "b" })).rejects.toThrow(/3 times/);
  expect(readFileSync(join(s.workdir, "many.txt"), "utf8")).toBe("a a a");
  expect(await s.run("edit", { path: "many.txt", old_string: "a", new_string: "b", replace_all: true })).toContain("replaced 3 occurrences");
  expect(readFileSync(join(s.workdir, "many.txt"), "utf8")).toBe("b b b");
  await expect(s.run("edit", { path: "many.txt", old_string: "", new_string: "x" })).rejects.toThrow(/old_string is required/);
});

test("edit refuses an edited file over 2MB and leaves the file as it was", async () => {
  const s = setup();
  writeFileSync(join(s.workdir, "one.txt"), "a");
  await expect(s.run("edit", { path: "one.txt", old_string: "a", new_string: "x".repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/larger than 2MB/);
  expect(readFileSync(join(s.workdir, "one.txt"), "utf8")).toBe("a");
});

test("glob finds files by pattern, skips .git and node_modules, and caps the answer", async () => {
  const s = setup();
  mkdirSync(join(s.workdir, "src"));
  mkdirSync(join(s.workdir, "node_modules"));
  mkdirSync(join(s.workdir, ".git"));
  writeFileSync(join(s.workdir, "a.ts"), "");
  writeFileSync(join(s.workdir, "src/b.ts"), "");
  writeFileSync(join(s.workdir, "node_modules/x.ts"), "");
  writeFileSync(join(s.workdir, ".git/y.ts"), "");
  expect(await s.run("glob", { pattern: "**/*.ts" })).toBe("a.ts\nsrc/b.ts");
  expect(await s.run("glob", { pattern: "**/*.nope" })).toBe("no files matched");
  await expect(s.run("glob", { pattern: "../*" })).rejects.toThrow(/inside/);

  mkdirSync(join(s.workdir, "lots"));
  for (let i = 0; i < 205; i++) writeFileSync(join(s.workdir, `lots/${i}.txt`), "");
  const capped = await s.run("glob", { pattern: "lots/*.txt" });
  expect(capped.split("\n").filter((line) => line.endsWith(".txt"))).toHaveLength(200);
  expect(capped).toContain("more files match");
});

test("grep returns path and line, respects include and case, skips binary files and caps results", async () => {
  const s = setup();
  mkdirSync(join(s.workdir, "src"));
  writeFileSync(join(s.workdir, "src/a.ts"), "TODO one\nconst x = 1\nTODO two");
  writeFileSync(join(s.workdir, "b.js"), "todo three");
  expect(await s.run("grep", { pattern: "TODO", include: "**/*.ts" })).toBe("src/a.ts:1: TODO one\nsrc/a.ts:3: TODO two");
  expect(await s.run("grep", { pattern: "todo", ignore_case: true })).toContain("b.js:1: todo three");
  expect(await s.run("grep", { pattern: "nothing-here" })).toBe("no matches");
  await expect(s.run("grep", { pattern: "(" })).rejects.toThrow(/invalid regular expression/);
  await expect(s.run("grep", { pattern: "x", include: "../*" })).rejects.toThrow(/include must stay inside/);

  writeFileSync(join(s.workdir, "binary.bin"), Buffer.from([0x54, 0x00, 0x4f, 0x44, 0x4f]));
  expect(await s.run("grep", { pattern: "TODO" })).not.toContain("binary.bin");

  writeFileSync(join(s.workdir, "many.log"), Array.from({ length: 250 }, () => "hit").join("\n"));
  const capped = await s.run("grep", { pattern: "hit", include: "many.log" });
  expect(capped.split("\n").filter((line) => line.startsWith("many.log:"))).toHaveLength(200);
  expect(capped).toContain("more matches");
});

test("the read-only runner has only read, glob and grep", async () => {
  const s = setup();
  const readOnly = fileTools({ workdir: s.workdir, readOnly: true });
  expect(readOnly.definitions().map((definition) => definition.name)).toEqual(["read", "glob", "grep"]);
  await expect(readOnly.run("write", { path: "x.txt", content: "x" })).rejects.toThrow(/no tool named write/);
  await expect(readOnly.run("edit", { path: "x.txt", old_string: "a", new_string: "b" })).rejects.toThrow(/no tool named edit/);
  expect(s.tools.definitions().map((definition) => definition.name)).toEqual(["read", "glob", "grep", "write", "edit"]);
});
