import { addMachine, getMachines } from "../../../entities/agent";
import { DELETE_WAIT, FROZEN_MESSAGE, getAccount, isFrozen, pairingRefusal, updateAccount } from "../../../entities/account";
import { getMembers, removeMember, setCurrentMember, type Member } from "../../../entities/member";
import { dropWorkOf } from "../../../features/demo-runtime";
import { owners } from "../../../features/membership";
import { authenticate, confirm } from "../../../shared/ui";

type Refusal = string | null;
const CANCELLED = "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";

// Sign-in recovery sends a code to the email; what comes back is the Hub account only (ADR 0013).
export function sendRecovery() {
  updateAccount({ recovery: "sent", recoveryCode: String(Math.floor(100_000 + Math.random() * 900_000)) });
}

export function verifyRecovery(code: string): Refusal {
  if (code.trim() !== getAccount().recoveryCode) return "รหัสไม่ถูกต้อง ดูรหัสล่าสุดที่ส่งไป email";
  updateAccount({ recovery: "recovered", recoveryCode: undefined });
  return null;
}

// The Hub counts the quota when a Machine is paired and says only that it is exceeded (ADR 0001, 0024).
// ponytail: stands in for the real Pairing at the Machine; it adds an empty Machine to the Workspace.
export async function tryPairing(member: Member): Promise<Refusal> {
  if (isFrozen(member.id)) return FROZEN_MESSAGE;
  const machines = getMachines();
  if (!(await authenticate("Pair Machine ใหม่เข้า Workspace"))) return CANCELLED;
  const refusal = pairingRefusal(machines.length);
  if (refusal) return refusal;
  addMachine(`machine-${machines.length + 1}`, "Linux");
  return null;
}

export const lastOwner = (member: Member) => member.owner && owners().length === 1;

// Deleting an account waits 30 days; the last Owner also deletes the Workspace (ADR 0024).
export async function requestDeletion(member: Member): Promise<Refusal> {
  if (isFrozen(member.id)) return FROZEN_MESSAGE;
  const workspace = lastOwner(member);
  if (!(await confirm({ title: "ลบบัญชี", message: "Hub จะลบ email, เครื่อง, Grant และ push token ของคุณ Task ที่คุณสั่งจะแสดงเป็น Member ที่ลบบัญชีแล้ว การลบจริงรอ 30 วัน ยกเลิกได้ตลอดช่วงนั้น", action: "ต่อไป", destructive: true }))) return null;
  if (workspace && !(await confirm({ title: "คุณเป็น Owner คนสุดท้าย", message: "ลบบัญชีนี้คือลบ Workspace ทั้งหมดด้วย subscription ถูกยกเลิกทันที และระหว่างรอ 30 วัน Workspace ถูกแช่แข็ง ข้อมูลบนเครื่องของคุณไม่ถูกลบ", action: "ลบ Workspace ด้วย", destructive: true }))) return null;
  if (!(await authenticate(workspace ? "ลบบัญชีและ Workspace" : "ลบบัญชีของคุณ"))) return CANCELLED;
  const now = Date.now();
  updateAccount({ deletion: { member: member.id, workspace, requestedAt: now, deleteAt: now + DELETE_WAIT }, ...(workspace ? { subscription: "cancelled" as const } : {}) });
  return null;
}

// The one command a frozen Workspace accepts, signed by the old Controller.
export async function cancelDeletion(): Promise<Refusal> {
  if (!(await authenticate("ยกเลิกการลบบัญชี"))) return CANCELLED;
  updateAccount({ deletion: undefined });
  return null;
}

// ponytail: stands in for the Hub's job that runs when the 30 days are up.
export function finishDeletion() {
  const deletion = getAccount().deletion;
  if (!deletion) return;
  if (deletion.workspace) {
    updateAccount({ deleted: true, deletion: undefined });
    return;
  }
  dropWorkOf(deletion.member);
  removeMember(deletion.member);
  updateAccount({ deletion: undefined });
  const next = getMembers().find((member) => member.owner && !member.removed);
  if (next) setCurrentMember(next.id);
}
