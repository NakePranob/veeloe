import type { IdleItem, IdleList, Pending } from "../../../entities/automation";

// The rules of background work that do not need a Runtime to be checked (ADR 0056, 0057, 0059).

// Changes keep merging while the file is quiet for `debounce` minutes, but never wait past this (ADR 0057).
export const MAX_WAIT_MINUTES = 30;

export const addChanges = (pending: Pending | undefined, count: number): Pending => ({ count: (pending?.count ?? 0) + count, quiet: 0, span: pending?.span ?? 0 });

// Time passes. A file that keeps changing resets the quiet time and adds a change a minute.
export const elapse = (pending: Pending, minutes: number, changing: boolean): Pending => ({
  count: pending.count + (changing ? minutes : 0),
  quiet: changing ? 0 : pending.quiet + minutes,
  span: pending.span + minutes,
});

export const isDue = (pending: Pending, debounce: number) => pending.quiet >= debounce || pending.span >= MAX_WAIT_MINUTES;

export const dueBecause = (pending: Pending, debounce: number) => (pending.quiet >= debounce ? "quiet" : "max");

// Tokens Idle Work and Watch may use together in a day, as a share of the Budget (ADR 0056).
export const ceilingLimit = (budget: number, percent: number) => Math.floor((budget * percent) / 100);

// The next item of a list: the signed order, or the signed rule over what is still to do.
export function pickItem(list: Pick<IdleList, "order" | "rule" | "items">): IdleItem | undefined {
  const todo = list.items.filter((item) => item.status === "todo");
  if (list.order === "fixed") return todo[0];
  return [...todo].sort(list.rule === "oldest" ? (a, b) => a.since - b.since : (a, b) => a.minutes - b.minutes)[0];
}

// The command an item asks for, if it names one in backticks.
export const commandOf = (item: Pick<IdleItem, "text">) => /`([^`]+)`/.exec(item.text)?.[1];

export type PathCheck = { ok: true; where: "workdir" | "library" | "machine" } | { ok: false; reason: string };

const SECRET = /(^|\/)(\.env(\..*)?|\.ssh|\.aws|\.gnupg|id_(rsa|ed25519)|[^/]*\.(pem|key|p12))(\/|$)/i;

// A Watch reads where its signer can read: Use and Approve only Workdir and Library, Manage the
// Machine except secret files (ADR 0057, 0059). `libraries` are those the Agent can read.
export function checkWatchPath(path: string, level: "use" | "manage", libraries: string[]): PathCheck {
  const text = path.trim();
  if (!text) return { ok: false, reason: "ใส่ path ที่จะเฝ้า" };
  if (text.split("/").includes("..")) return { ok: false, reason: "path ที่ออกนอกโฟลเดอร์ด้วย .. ใช้ไม่ได้" };
  if (SECRET.test(text)) return { ok: false, reason: "เฝ้าไฟล์ลับไม่ได้ ไม่ว่าใครตั้ง" };
  if (text === "workdir" || text.startsWith("workdir/")) return { ok: true, where: "workdir" };
  if (text.startsWith("library/")) {
    const id = text.split("/")[1];
    return libraries.includes(id) ? { ok: true, where: "library" } : { ok: false, reason: `Agent นี้อ่าน Library ${id || "นี้"} ไม่ได้` };
  }
  if (level === "manage") return { ok: true, where: "machine" };
  return { ok: false, reason: "คนที่มีแค่ Use เฝ้าได้แค่ Workdir กับ Library ใช้ Watch สืบไฟล์อื่นบนเครื่องไม่ได้ (ADR 0059)" };
}
