/**
 * Allowlist ของ Agent หนึ่งตัว (ADR 0030): คำนำหน้าของคำสั่ง bash หรือชื่อเต็ม
 * ของ tool จาก Connector รายการแต่ละตัวเทียบทีละคำจากต้นคำสั่ง
 *
 * กฎนี้เป็นโค้ดด้านความปลอดภัย: ทุกอย่างที่แยกไม่ได้หรือไม่แน่ใจต้องตอบว่า
 * ไม่ผ่าน (fail-closed) เพื่อให้ไปขอ Approval แทน
 */

/** Allowlist เริ่มต้นแบบอ่านอย่างเดียวที่หน้าสร้าง Agent ติ๊กไว้ให้ (`approval-and-allowlist`). */
export const READ_ONLY_ALLOWLIST = ["ls", "pwd", "cat", "head", "tail", "wc", "git status", "git diff", "git log"] as const;

/** จำนวนรายการมากสุดต่อ Agent หนึ่งตัว. */
export const ALLOWLIST_MAX = 100;

import { z } from "zod";

/** รายการหนึ่งตัว: ข้อความไม่ว่างเปล่า. */
export const AllowlistEntrySchema = z.string().min(1).max(500);

/** Allowlist ทั้งชุดของ Agent ตัวหนึ่ง. */
export const AllowlistSchema = z.array(AllowlistEntrySchema).max(ALLOWLIST_MAX);
export type Allowlist = z.infer<typeof AllowlistSchema>;

/** คำสั่งแรกที่รันแทนที่โปรเซสตัวเองหรือตีความคำสั่งอื่น: ต้องขอ Approval ทุกครั้ง. */
const DANGEROUS_FIRST = new Set(["eval", "exec"]);
/** คำสั่งห่อที่ส่งต่อให้คำสั่งถัดไปทำแทน: `builtin eval ...` อันตรายเหมือน `eval ...`. */
const WRAPPERS = new Set(["builtin", "command"]);

/**
 * คำสั่งที่ผ่านได้โดยไม่ต้องอยู่ใน Allowlist (ADR 0075): แสดงผลหรืออ่านอย่างเดียว
 * และไม่รันโปรแกรมอื่น ส่วน `date`, `sort`, `find`, `rg` และ `git` ผ่านได้ยกเว้น
 * flag ที่ `builtInCovers` ระบุ ต้องตรงกับ `BUILT_IN` ใน packages/protocol/src/allowlist.rs
 */
const BUILT_IN = new Set(["echo", "printf", "true", "false", "pwd", "which", "basename", "dirname", "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "tree", "uniq", "cut", "tr", "diff", "cmp", "grep", "egrep", "fgrep"]);
/** คำสั่งย่อยของ `git` ที่แค่อ่าน repo. */
const GIT_READS = new Set(["status", "diff", "log", "show", "rev-parse", "blame", "ls-files"]);
/** คำเดียวที่ `git branch` มีได้แล้วยังผ่าน: แค่แสดงรายการ ไม่เปลี่ยน branch. */
const GIT_BRANCH_FLAGS = new Set(["-a", "-r", "-v", "-vv", "-l", "--all", "--remotes", "--verbose", "--list", "--show-current", "--no-color", "--color"]);
/** action ของ `find` ที่รันโปรแกรม ลบ หรือเขียนไฟล์. */
const FIND_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

/**
 * แยกคำสั่งหนึ่งชุดออกเป็นท่อนๆ ตามตัวเชื่อม `&&`, `||`, `;`, `|`, `&` และ
 * การขึ้นบรรทัดใหม่ โดยไม่แยกข้างใน single quote, double quote และหลัง
 * backslash ท่อนว่างถูกทิ้ง `&` ท้ายบรรทัด (รัน background) ไม่เหลือเป็นท่อน
 */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    current = "";
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      current += ch;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      push();
      continue;
    }
    if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
      push();
      i++;
      continue;
    }
    if (ch === "&" || ch === "|") {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return parts;
}

type Span = { from: number; to: number };

/**
 * ช่วงที่อยู่ใน quote ช่วงที่ escape และช่วงเปรียบเทียบ `[[ ... ]]` กับ
 * `(( ... ))` ซึ่ง `<` `>` ข้างในเป็นแค่การเทียบ ไม่ใช่ redirect
 */
function blankSpans(text: string): Span[] {
  const spans: Span[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let i = 0;
  const push = (from: number, to: number) => {
    if (to > from) spans.push({ from, to });
  };
  while (i < text.length) {
    const ch = text[i];
    if (escaped) {
      push(i - 1, i + 1);
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        push(i, i + 1);
        quote = null;
      } else push(i, i + 1);
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      push(i, i + 1);
      quote = ch;
      i++;
      continue;
    }
    if ((ch === "[" && text[i + 1] === "[") || (ch === "(" && text[i + 1] === "(")) {
      const close = ch === "[" ? "]]" : "))";
      const end = text.indexOf(close, i + 2);
      if (end === -1) {
        i++;
        continue;
      }
      push(i, end + 2);
      i = end + 2;
      continue;
    }
    i++;
  }
  if (escaped) push(text.length - 1, text.length);
  return spans;
}

/** ตัวที่ปิดคำของ redirect: ช่องว่าง ตัวเชื่อม หรือวงเล็บ. */
const isGap = (ch: string | undefined) => ch !== undefined && (/\s/.test(ch) || ";|&()".includes(ch));
const endsAt = (text: string, at: number) => at >= text.length || isGap(text[at]);

/**
 * redirect ที่ไม่เขียนไฟล์ (ADR 0075): `>` หรือ `>>` ไป `/dev/null` จะมี file
 * descriptor หรือ `&` นำหน้าก็ได้ และ `>&1` / `>&2` อ่านจากโค้ดที่ blank แล้ว
 * ตัวใน quote จึงไม่นับ redirect แบบอื่นปล่อยให้ `isUnsafeCommand` ปฏิเสธ
 */
function nullRedirects(code: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] !== ">") {
      i++;
      continue;
    }
    const start = i > 0 && /[0-9&]/.test(code[i - 1]) && (i === 1 || isGap(code[i - 2])) ? i - 1 : i;
    if (code[i + 1] === "&" && (code[i + 2] === "1" || code[i + 2] === "2") && endsAt(code, i + 3)) {
      spans.push({ from: start, to: i + 3 });
      i += 3;
      continue;
    }
    let at = code[i + 1] === ">" ? i + 2 : i + 1;
    while (code[at] === " ") at++;
    if (code.startsWith("/dev/null", at) && endsAt(code, at + 9)) {
      spans.push({ from: start, to: at + 9 });
      i = at + 9;
      continue;
    }
    i++;
  }
  return spans;
}

function blanked(text: string, spans: Span[]): string {
  const chars = [...text];
  for (const { from, to } of spans) for (let i = from; i < Math.min(to, chars.length); i++) chars[i] = " ";
  return chars.join("");
}

/**
 * บอกว่าคำสั่งนี้แยกให้แน่ใจไม่ได้ ต้องขอ Approval ทุกครั้ง (ADR 0030):
 * มี `$(...)`, backtick, redirect (`>`, `>>`, `>|`, `>&`, `<`, `<>`, `<<`,
 * heredoc) ที่ไม่ใช่ไป `/dev/null` หรือ `>&1` / `>&2` (ADR 0075) หรือเรียก `eval` / `exec` เป็นคำแรกของท่อนใดท่อนหนึ่ง
 * (รวม `builtin` / `command` ที่ห่อสองตัวนี้) การตรวจข้ามสิ่งที่อยู่ใน quote
 * กับการเทียบใน `[[ ... ]]` / `(( ... ))` เพราะข้างในนั้นไม่ใช่คำสั่ง
 */
export function isUnsafeCommand(command: string): boolean {
  const quoted = blanked(command, blankSpans(command));
  const code = blanked(quoted, nullRedirects(quoted));
  if (code.includes("$(") || code.includes("`")) return true;
  if (code.includes(">") || code.includes("<")) return true;
  return splitCommand(code).some((part) => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const [first, second] = words;
    if (first === undefined) return false;
    if (DANGEROUS_FIRST.has(first)) return true;
    return WRAPPERS.has(first) && second !== undefined && DANGEROUS_FIRST.has(second);
  });
}

/** แยกคำแบบยุบช่องว่าง เหมือนที่ bash ทำก่อนรัน. */
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** คำสั่งที่ blank redirect ไป `/dev/null` (และ `>&1` / `>&2`) ออกแล้ว: `cat MEMORY.md 2>/dev/null` เทียบเป็น `cat MEMORY.md`. */
function withoutNullRedirects(command: string): string {
  return blanked(command, nullRedirects(blanked(command, blankSpans(command))));
}

/** คำแบบที่ bash ส่งต่อ: ตัด quote ทิ้ง backslash เหลือแค่ตัวถัดไป พอให้รู้ว่า `'-ex'ec` และ `-e\xec` คือ `-exec`. */
function unquoted(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === "'" || ch === '"') continue;
    if (ch === "\\") {
      i++;
      if (i < word.length) out += word[i];
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * บอกว่าท่อนนี้ผ่านได้โดยไม่ต้องมีรายการใน Allowlist (ADR 0075): แสดงผลหรืออ่าน
 * และไม่รันโปรแกรมอื่น ใช้กับท่อนที่ `isUnsafeCommand` ปล่อยผ่านแล้วเท่านั้น
 */
export function builtInCovers(part: string): boolean {
  const [first, ...rest] = words(part).map(unquoted);
  if (first === undefined) return false;
  switch (first) {
    // ตั้งเวลาเครื่อง: `-s`, `--set` และ short flag ที่รวม `s` ไว้
    case "date":
      return !rest.some((w) => w.startsWith("--set") || (w.startsWith("-") && !w.startsWith("--") && w.includes("s")));
    case "sort":
      return !rest.some((w) => w.startsWith("--compress-program"));
    case "rg":
      return !rest.some((w) => w.startsWith("--pre"));
    case "find":
      return !rest.some((w) => FIND_ACTIONS.has(w));
    case "git": {
      const [sub, ...flags] = rest;
      if (sub === undefined) return false;
      if (sub === "branch") return flags.every((w) => GIT_BRANCH_FLAGS.has(w));
      return GIT_READS.has(sub);
    }
    default:
      return BUILT_IN.has(first);
  }
}

/**
 * บอกว่าคำสั่งหนึ่งชุดรันได้เลยไหม: ต้องไม่เป็นคำสั่งอันตราย และทุกท่อน
 * ต้องมีคำนำหน้าใน Allowlist อย่างน้อยหนึ่งรายการ เทียบทีละคำจากต้นท่อน
 * หรือเป็นคำสั่งที่ผ่านเสมอ (ADR 0075)
 */
export function matchesAllowlist(command: string, allowlist: readonly string[]): boolean {
  if (isUnsafeCommand(command)) return false;
  const parts = splitCommand(withoutNullRedirects(command));
  if (parts.length === 0) return false;
  return parts.every((part) => {
    if (builtInCovers(part)) return true;
    const partWords = words(part);
    return allowlist.some((entry) => {
      const entryWords = words(entry);
      return entryWords.length > 0 && partWords.length >= entryWords.length && entryWords.every((w, i) => partWords[i] === w);
    });
  });
}

/**
 * บอกว่ารายการเดียวนี้ครอบคำสั่งนี้ในฐานะคำนำหน้าไหม เทียบทีละคำจากต้น โดยไม่ดูกฎ
 * ความปลอดภัยและไม่นับคำสั่งที่ผ่านเสมอ หน้า Allowlist ใช้บอกว่ารายการไหนครอบอะไร
 * ต้องตรงกับ `entry_covers` ใน packages/protocol/src/allowlist.rs
 */
export function entryCovers(entry: string, command: string): boolean {
  const entryWords = words(entry);
  const commandWords = words(command);
  return entryWords.length > 0 && commandWords.length >= entryWords.length && entryWords.every((w, i) => commandWords[i] === w);
}
