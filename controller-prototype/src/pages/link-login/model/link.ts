import { getAccount, isFrozen, FROZEN_MESSAGE } from "../../../entities/account";
import { createLinkRequest, getLinkRequests, patchLinkRequest } from "../../../entities/linking";
import { addDevice, getMembers, thisDevice, type Device } from "../../../entities/member";
import { pushNotification } from "../../../entities/notification";
import { shortCode } from "../../../shared/lib";
import { authenticate } from "../../../shared/ui";

type Refusal = string | null;

export const codesOf = (key: string, seenKey: string) => ({ newDevice: shortCode(key), oldDevice: shortCode(seenKey) });

// The new device logs in with the email; the Hub finds the account and pushes a request to a
// device the Member already has. The login proves nothing about who is holding the new key (ADR 0013).
export function startLogin(memberId: string, email: string, deviceName: string, kind: Device["kind"], swapped: boolean): Refusal {
  if (isFrozen(memberId)) return FROZEN_MESSAGE;
  if (email.trim().toLowerCase() !== getAccount().email.toLowerCase()) return "Hub ไม่พบบัญชีที่ใช้ email นี้";
  const member = getMembers().find((candidate) => candidate.id === memberId);
  if (!member || !thisDevice(member)) return "ไม่มีเครื่องเดิมที่จะรับคำขอ ใช้ Invitation จาก Owner คนอื่น หรือกู้บัญชีที่หน้าบัญชี";
  if (!deviceName.trim()) return "ตั้งชื่อเครื่องใหม่ก่อน";
  const key = `ed25519:new-${Math.random().toString(36).slice(2, 10)}`;
  createLinkRequest({ member: memberId, deviceName: deviceName.trim(), kind, seenKey: swapped ? `${key}-hub` : key }, key);
  // Content-free: it says a request waits, not what for (ADR 0005, 0044).
  pushNotification({ kind: "approval", member: memberId, title: "มีคำขอ Link เครื่องใหม่รออยู่", href: "/devices/link-login" });
  return null;
}

// The old device compares the codes. A match plus Face ID signs the new device's certificate (ADR 0012, 0031).
export async function decide(id: string, memberId: string, matches: boolean): Promise<Refusal> {
  const request = getLinkRequests().find((candidate) => candidate.id === id);
  const member = getMembers().find((candidate) => candidate.id === memberId);
  if (!request || request.stage !== "waiting" || !member) return "คำขอนี้ไม่รออยู่แล้ว";
  if (isFrozen(memberId)) return FROZEN_MESSAGE;
  const { newDevice, oldDevice } = codesOf(request.key, request.seenKey);
  if (!matches) {
    patchLinkRequest(id, { stage: "denied", refusal: "เจ้าของเทียบรหัสแล้วไม่ตรงหรือไม่ใช่เครื่องของตัวเอง จึงปฏิเสธ" });
    return null;
  }
  if (newDevice.join() !== oldDevice.join()) {
    patchLinkRequest(id, { stage: "denied", refusal: "รหัสสองเครื่องไม่ตรงกัน จึงไม่เซ็นรับรอง กุญแจนี้อาจถูกสลับระหว่างทาง" });
    return "รหัสสองเครื่องไม่ตรงกันจริง จึงไม่เซ็นรับรอง";
  }
  if (!(await authenticate(`เซ็นรับรอง ${request.deviceName} เป็นเครื่องของ ${member.name}`))) return "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";
  const signer = thisDevice(member);
  if (!signer) return "ไม่มีเครื่องที่จะเซ็น";
  addDevice(memberId, request.deviceName, request.kind, signer.id);
  patchLinkRequest(id, { stage: "approved" });
  return null;
}
