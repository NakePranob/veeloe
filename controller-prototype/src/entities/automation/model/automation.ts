import { createStore } from "../../../shared/lib";

// What a Member signed for the Agent to do without being asked: a Schedule (ADR 0027), an Idle
// Work list (ADR 0056) or a Watch (ADR 0057). Each keeps the key that signed it, because it
// stops the moment that key is revoked (ADR 0031).

export interface Signed {
  signedBy: string;
  // The Controller key that signed it, so a revoked key can stop it.
  signedDevice: string;
  signedAt: number;
}

export type RunKind = "ran" | "silent" | "skipped" | "missed" | "caught-up" | "refused" | "unfinished" | "ignored" | "merged" | "note";

// What happened at each round, so a skipped or refused one is never invisible.
export interface RunLog {
  at: number;
  kind: RunKind;
  note: string;
  task?: string;
}

export interface Cadence {
  value: string;
  label: string;
  minutes: number;
}

// ponytail: four fixed cadences; a cron editor waits for a real Runtime clock.
export const CADENCES: Cadence[] = [
  { value: "30m", label: "ทุก 30 นาที", minutes: 30 },
  { value: "1h", label: "ทุกชั่วโมง", minutes: 60 },
  { value: "daily", label: "ทุกวัน 08:00", minutes: 24 * 60 },
  { value: "weekly", label: "ทุกวันจันทร์ 09:00", minutes: 7 * 24 * 60 },
];

export interface Schedule extends Signed {
  id: string;
  agent: string;
  message: string;
  cadence: string;
  // Who hears about a round that has something to say (ADR 0044).
  notify: "setter" | "everyone";
  paused: boolean;
  lastRunAt?: number;
  // Rounds the Machine missed while it was off; they run once when it is back (ADR 0027).
  missed?: { count: number; first: number };
  log: RunLog[];
}

export type ItemStatus = "todo" | "done" | "unfinished" | "skipped";

export interface IdleItem {
  id: string;
  text: string;
  // How long it has waited, for the signed picking rule.
  since: number;
  // How long the work takes, in minutes, which the simulation compares with the cap.
  minutes: number;
  status: ItemStatus;
}

export type PickRule = "oldest" | "smallest";
export const RULE_LABEL: Record<PickRule, string> = { oldest: "ค้างนานสุดก่อน", smallest: "ชิ้นเล็กสุดก่อน" };

export interface IdleList extends Signed {
  id: string;
  agent: string;
  name: string;
  order: "fixed" | "rule";
  rule: PickRule;
  items: IdleItem[];
  // Quiet needed before the Agent wakes, and the longest one item may run (ADR 0056).
  quietMinutes: number;
  capMinutes: number;
  paused: boolean;
  // Whether the Agent wrote the list or the Member did.
  proposedBy: "agent" | "member";
  lastRunAt?: number;
  log: RunLog[];
}

// Changes waiting to be merged into one job: minutes are simulated (ADR 0057).
export interface Pending {
  count: number;
  quiet: number;
  span: number;
}

export interface Watch extends Signed {
  id: string;
  agent: string;
  path: string;
  on: "changed" | "new";
  action: string;
  debounceMinutes: number;
  paused: boolean;
  proposedBy: "agent" | "member";
  pending?: Pending;
  // A file changed while the Machine was off; compared when it is back.
  changedWhileOff?: boolean;
  lastRunAt?: number;
  log: RunLog[];
}

// The index of the Tasks one origin opened (ADR 0061). It holds no content.
export interface Thread {
  origin: string;
  title: string;
  agent: string;
  kind: "schedule" | "idle" | "watch";
}

interface State {
  schedules: Schedule[];
  lists: IdleList[];
  watches: Watch[];
  threads: Thread[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const key = (member: string) => (member === "m_nok" ? "d_nok_phone" : member === "m_mint" ? "d_mint_phone" : "d_kai_phone");

const store = createStore<State>({
  schedules: [
    { id: "sch-prs", agent: "reviewer", message: "ไล่ดู PR ที่ค้างรีวิวเกิน 1 วัน แล้วสรุปให้ ถ้าไม่มีให้เงียบ", cadence: "daily", notify: "everyone", paused: false, signedBy: "m_nok", signedDevice: key("m_nok"), signedAt: now - 6 * DAY, lastRunAt: now - 3 * HOUR, log: [] },
    { id: "sch-memory", agent: "writer", message: "ย่อบันทึกของสัปดาห์นี้ลง MEMORY.md ให้ไม่เกิน 4,000 ตัวอักษร", cadence: "weekly", notify: "setter", paused: false, signedBy: "m_kai", signedDevice: key("m_kai"), signedAt: now - 20 * DAY, lastRunAt: now - 2 * DAY, log: [] },
  ],
  lists: [
    {
      id: "idle-docs",
      agent: "tester",
      name: "งานบ้านของ Tester",
      order: "rule",
      rule: "oldest",
      items: [
        { id: "i1", text: "หา test ที่ flaky จากผล 7 วันล่าสุด", since: now - 9 * DAY, minutes: 8, status: "todo" },
        { id: "i2", text: "ลบ snapshot ที่ไม่มี test อ้างถึง", since: now - 4 * DAY, minutes: 4, status: "todo" },
        { id: "i3", text: "รัน `npm run deploy:staging` เพื่อเช็กว่า build ล่าสุดขึ้นได้", since: now - 3 * DAY, minutes: 6, status: "todo" },
        { id: "i4", text: "เขียน coverage ของโมดูล auth ใหม่ทั้งหมด", since: now - 2 * DAY, minutes: 40, status: "todo" },
      ],
      quietMinutes: 15,
      capMinutes: 15,
      paused: false,
      proposedBy: "agent",
      signedBy: "m_kai",
      signedDevice: key("m_kai"),
      signedAt: now - 5 * DAY,
      log: [],
    },
  ],
  watches: [
    { id: "watch-notes", agent: "deployer", path: "workdir/releases/", on: "new", action: "อ่านไฟล์ release ใหม่แล้วเช็กรายการก่อน deploy", debounceMinutes: 5, paused: false, proposedBy: "member", signedBy: "m_nok", signedDevice: key("m_nok"), signedAt: now - 3 * DAY, log: [] },
  ],
  threads: [],
});

export const useAutomation = store.use;
export const getAutomation = store.get;
export const subscribeAutomation = store.subscribe;

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${++counter}`;

type Kind = "schedules" | "lists" | "watches";

export function addAutomation<K extends Kind>(kind: K, item: State[K][number]) {
  store.set((state) => ({ ...state, [kind]: [...state[kind], item] }));
}

export function updateAutomation<K extends Kind>(kind: K, id: string, patch: Partial<State[K][number]>) {
  store.set((state) => ({ ...state, [kind]: (state[kind] as { id: string }[]).map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
}

export function removeAutomation(kind: Kind, id: string) {
  store.set((state) => ({ ...state, [kind]: (state[kind] as { id: string }[]).filter((item) => item.id !== id) }));
}

export function logRun(kind: Kind, id: string, entry: Omit<RunLog, "at">) {
  store.set((state) => ({
    ...state,
    [kind]: (state[kind] as { id: string; log: RunLog[] }[]).map((item) => (item.id === id ? { ...item, log: [...item.log, { ...entry, at: Date.now() }] } : item)),
  }));
}

export function setItem(listId: string, itemId: string, patch: Partial<IdleItem>) {
  store.set((state) => ({
    ...state,
    lists: state.lists.map((list) => (list.id === listId ? { ...list, items: list.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) } : list)),
  }));
}

export function upsertThread(thread: Thread) {
  store.set((state) => (state.threads.some((candidate) => candidate.origin === thread.origin) ? state : { ...state, threads: [...state.threads, thread] }));
}

// Deleting a thread removes the index only; the Tasks stay (ADR 0061).
export function removeThread(origin: string) {
  store.set((state) => ({ ...state, threads: state.threads.filter((thread) => thread.origin !== origin) }));
}
