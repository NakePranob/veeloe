import { createStore } from "../../../shared/lib";

const DAY = 86_400_000;
export const DELETE_WAIT = 30 * DAY;

// Sign-in recovery returns the Hub account and nothing else (ADR 0013).
export type Recovery = "idle" | "sent" | "recovered";

export interface Deletion {
  member: string;
  // The last Owner chose to delete the whole Workspace too (ADR 0024).
  workspace: boolean;
  requestedAt: number;
  deleteAt: number;
}

export interface Account {
  email: string;
  // Machines billed on the web, beyond the one that is free (ADR 0001, 0024).
  paidMachines: number;
  subscription: "active" | "cancelled";
  recovery: Recovery;
  // What the Hub emailed; the person types it back.
  recoveryCode?: string;
  deletion?: Deletion;
  // The Workspace is gone from the Hub after the wait (ADR 0024).
  deleted?: boolean;
}

const account = createStore<Account>({ email: "kai@example.com", paidMachines: 3, subscription: "active", recovery: "idle" });

export const useAccount = account.use;
export const getAccount = account.get;

export function updateAccount(patch: Partial<Account>) {
  account.set((current) => ({ ...current, ...patch }));
}

export const FREE_MACHINES = 1;

// The Hub counts quota at Pairing and says only that it is exceeded (ADR 0001, 0024).
export function quota(current: Account) {
  return current.subscription === "active" ? FREE_MACHINES + current.paidMachines : FREE_MACHINES;
}

export function pairingRefusal(machines: number, current = account.get()) {
  return machines >= quota(current) ? "เกินโควตา Machine ของ Workspace นี้" : null;
}

// Hub refuses every command while the account waits to be deleted, except cancelling it.
export function isFrozen(memberId: string, current = account.get()) {
  return !!current.deleted || (!!current.deletion && (current.deletion.workspace || current.deletion.member === memberId));
}

export const FROZEN_MESSAGE = "บัญชีกำลังรอลบ ทุกคำสั่งถูกปฏิเสธ ยกเว้นการยกเลิกการลบที่หน้าบัญชี";

export function useFrozen(memberId: string) {
  return isFrozen(memberId, account.use());
}
