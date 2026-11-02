import { createStore } from "../../../shared/lib";

// The categories a Member can silence (ADR 0044).
export type PushKind = "approval" | "turn" | "budget" | "mention" | "schedule" | "background" | "claim" | "connector" | "skill" | "link";

export const PUSH_LABEL: Record<PushKind, string> = {
  approval: "Approval รออยู่",
  turn: "Turn เสร็จ",
  budget: "Budget ถึง 80% หรือหมด",
  mention: "ถูก Mention",
  schedule: "Schedule มีเรื่องจะบอก",
  background: "Idle Work หรือ Watch มีเรื่องจะบอก",
  claim: "คำขอ /claim",
  connector: "Connector ต้อง login ใหม่",
  skill: "Agent เสนอ Skill ใหม่",
  // A security alert, so Notifications offers no way to silence it (ADR 0031).
  link: "มีเครื่องใหม่ถูก Link",
};

export interface Notification {
  id: number;
  kind: PushKind;
  // Who it is for. It says which Agent has something, never the content (ADR 0005).
  member: string;
  agent?: string;
  title: string;
  href: string;
  at: number;
  // Cleared once the thing it waited for is done, on every device (ADR 0053).
  cleared?: boolean;
}

const items = createStore<Notification[]>([]);
const muted = createStore<{ kinds: PushKind[]; agents: string[] }>({ kinds: [], agents: [] });

export const useNotifications = items.use;
export const usePushSettings = muted.use;
export const setPushSettings = muted.set;

let counter = 0;

export function pushNotification(input: Omit<Notification, "id" | "at">) {
  const settings = muted.get();
  if (settings.kinds.includes(input.kind) || (input.agent && settings.agents.includes(input.agent))) return;
  items.set((all) => [...all, { ...input, id: ++counter, at: Date.now() }]);
}

// Silent push: the thing is answered, so the alert goes from every device.
export function clearNotifications(href: string) {
  items.set((all) => all.map((item) => (item.href === href ? { ...item, cleared: true } : item)));
}

export function dismissNotification(id: number) {
  items.set((all) => all.map((item) => (item.id === id ? { ...item, cleared: true } : item)));
}
