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

function blanked(text: string, spans: Span[]): string {
  const chars = [...text];
  for (const { from, to } of spans) for (let i = from; i < Math.min(to, chars.length); i++) chars[i] = " ";
  return chars.join("");
}

/**
 * บอกว่าคำสั่งนี้แยกให้แน่ใจไม่ได้ ต้องขอ Approval ทุกครั้ง (ADR 0030):
 * มี `$(...)`, backtick, redirect (`>`, `>>`, `>|`, `>&`, `<`, `<>`, `<<`,
 * heredoc) หรือเรียก `eval` / `exec` เป็นคำแรกของท่อนใดท่อนหนึ่ง
 * (รวม `builtin` / `command` ที่ห่อสองตัวนี้) การตรวจข้ามสิ่งที่อยู่ใน quote
 * กับการเทียบใน `[[ ... ]]` / `(( ... ))` เพราะข้างในนั้นไม่ใช่คำสั่ง
 */
export function isUnsafeCommand(command: string): boolean {
  const code = blanked(command, blankSpans(command));
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

/**
 * บอกว่าคำสั่งหนึ่งชุดรันได้เลยไหม: ต้องไม่เป็นคำสั่งอันตราย และทุกท่อน
 * ต้องมีคำนำหน้าใน Allowlist อย่างน้อยหนึ่งรายการ เทียบทีละคำจากต้นท่อน
 */
export function matchesAllowlist(command: string, allowlist: readonly string[]): boolean {
  if (isUnsafeCommand(command)) return false;
  const parts = splitCommand(command);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const partWords = words(part);
    return allowlist.some((entry) => {
      const entryWords = words(entry);
      return entryWords.length > 0 && partWords.length >= entryWords.length && entryWords.every((w, i) => partWords[i] === w);
    });
  });
}
