import { describe, expect, test } from "bun:test";
import { ALLOWLIST_MAX, AllowlistSchema, isUnsafeCommand, matchesAllowlist, READ_ONLY_ALLOWLIST, splitCommand } from "./allowlist";

describe("splitCommand", () => {
  test("splits on &&, ;, | and a lone &", () => {
    expect(splitCommand("git status && ls")).toEqual(["git status", "ls"]);
    expect(splitCommand("git status; ls")).toEqual(["git status", "ls"]);
    expect(splitCommand("ls | head")).toEqual(["ls", "head"]);
    expect(splitCommand("a || b")).toEqual(["a", "b"]);
    expect(splitCommand("ls & rm -rf dist")).toEqual(["ls", "rm -rf dist"]);
  });

  test("a trailing & runs the same part in the background", () => {
    expect(splitCommand("sleep 1 &")).toEqual(["sleep 1"]);
  });

  test("splits on newlines and drops empty parts", () => {
    expect(splitCommand("ls\n\npwd\n")).toEqual(["ls", "pwd"]);
  });

  test("does not split inside quotes", () => {
    expect(splitCommand('echo "a && b"')).toEqual(['echo "a && b"']);
    expect(splitCommand("echo 'a; b'")).toEqual(["echo 'a; b'"]);
    expect(splitCommand('echo "a | b" && ls')).toEqual(['echo "a | b"', "ls"]);
  });
});

describe("isUnsafeCommand", () => {
  test("flags command substitution, backticks, eval and exec", () => {
    expect(isUnsafeCommand("echo $(rm -rf dist)")).toBe(true);
    expect(isUnsafeCommand("echo `rm -rf dist`")).toBe(true);
    expect(isUnsafeCommand("eval echo hi")).toBe(true);
    expect(isUnsafeCommand("exec 3>&1")).toBe(true);
    expect(isUnsafeCommand("ls && eval foo")).toBe(true);
    expect(isUnsafeCommand("builtin exec foo")).toBe(true);
    expect(isUnsafeCommand("command eval foo")).toBe(true);
  });

  test("flags redirections and heredocs, even glued to words", () => {
    expect(isUnsafeCommand("ls > /etc/passwd")).toBe(true);
    expect(isUnsafeCommand("echo hi>out.txt")).toBe(true);
    expect(isUnsafeCommand("cat < /etc/shadow")).toBe(true);
    expect(isUnsafeCommand("cat <<EOF")).toBe(true);
    expect(isUnsafeCommand("cmd 2>&1")).toBe(true);
    expect(isUnsafeCommand("diff <(a) <(b)")).toBe(true);
  });

  test("ignores those markers inside quotes, after a backslash, or as comparisons", () => {
    expect(isUnsafeCommand('echo "$(not a command)"')).toBe(false);
    expect(isUnsafeCommand("echo '`not a command`'")).toBe(false);
    expect(isUnsafeCommand('echo "a > b"')).toBe(false);
    expect(isUnsafeCommand("echo a\\>b")).toBe(false);
    expect(isUnsafeCommand("[[ $x > 1 ]] && echo big")).toBe(false);
    expect(isUnsafeCommand("for ((i = 0; i < 10; i++)); do echo $i; done")).toBe(false);
  });

  test("plain commands are safe", () => {
    expect(isUnsafeCommand("npm test -- --watch")).toBe(false);
    expect(isUnsafeCommand("git status && ls")).toBe(false);
  });

  test("a lone & is a separator, not a danger of its own", () => {
    expect(isUnsafeCommand("sleep 1 &")).toBe(false);
  });
});

describe("matchesAllowlist", () => {
  const list = [...READ_ONLY_ALLOWLIST, "npm test"];

  test("a prefix covers extra flags", () => {
    expect(matchesAllowlist("npm test -- --watch", list)).toBe(true);
  });

  test("a longer word is not covered", () => {
    expect(matchesAllowlist("npm tester", list)).toBe(false);
  });

  test("every part must pass, including across a background &", () => {
    expect(matchesAllowlist("git status && ls", list)).toBe(true);
    expect(matchesAllowlist("git status && rm -rf dist", list)).toBe(false);
    expect(matchesAllowlist("ls | head", list)).toBe(true);
    expect(matchesAllowlist("ls & rm -rf dist", list)).toBe(false);
    expect(matchesAllowlist("sleep 1 &", ["sleep 1"])).toBe(true);
  });

  test("unsafe commands always need approval", () => {
    expect(matchesAllowlist("echo $(rm -rf dist)", ["echo"])).toBe(false);
    expect(matchesAllowlist("eval echo hi", ["echo", "eval"])).toBe(false);
    expect(matchesAllowlist("ls > out.txt", ["ls"])).toBe(false);
    expect(matchesAllowlist("exec node server.js", ["exec", "node"])).toBe(false);
  });

  test("a pipe to an uncovered command needs approval", () => {
    expect(matchesAllowlist("ls | sort", list)).toBe(false);
    expect(matchesAllowlist("ls | sort", [...list, "sort"])).toBe(true);
  });

  test("extra whitespace still matches word by word", () => {
    expect(matchesAllowlist("git   status", ["git status"])).toBe(true);
  });

  test("an empty command or empty allowlist never passes", () => {
    expect(matchesAllowlist("", list)).toBe(false);
    expect(matchesAllowlist("ls", [])).toBe(false);
  });
});

describe("AllowlistSchema", () => {
  test("accepts the read-only set and rejects bad entries", () => {
    expect(AllowlistSchema.safeParse([...READ_ONLY_ALLOWLIST]).success).toBe(true);
    expect(AllowlistSchema.safeParse([""]).success).toBe(false);
    expect(AllowlistSchema.safeParse(new Array(ALLOWLIST_MAX + 1).fill("ls")).success).toBe(false);
  });
});
