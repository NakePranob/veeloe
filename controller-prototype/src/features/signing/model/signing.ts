import { can, getCurrentMember, getMembers, thisDevice, useMembers, type Grant } from "../../../entities/member";

// Things a Member signed run on their behalf and stop the moment the key that signed them is
// revoked, their Member is removed, or they no longer hold the Grant that lets them (ADR 0031).
// Schedule, Idle Work, Watch and Connector all follow this one rule.

export interface Signature {
  signedBy: string;
  signedDevice: string;
}

function reason(signature: Signature, agentId: string, level: Grant) {
  const member = getMembers().find((candidate) => candidate.id === signature.signedBy);
  if (!member || member.removed) return "Member ที่เซ็นถูกลบ";
  const device = member.devices.find((candidate) => candidate.id === signature.signedDevice);
  if (!device || device.revoked) return "กุญแจที่เซ็นถูกถอน";
  if (!can(member, agentId, level)) return `คนที่เซ็นไม่เหลือ ${level === "use" ? "Use" : "Manage"} ที่ Agent นี้`;
  return null;
}

// Why it stopped, or null when it runs. Re-reads when Members change.
export function useStoppedReason(signature: Signature, agentId: string, level: Grant = "use") {
  useMembers();
  return reason(signature, agentId, level);
}

export const stoppedReason = reason;

// The signer, or an Owner, signs again from a key that still works (ADR 0027).
export function canResign(signature: Signature) {
  const me = getCurrentMember();
  return !!thisDevice(me) && (me.owner || me.id === signature.signedBy);
}

export function newSignature() {
  const me = getCurrentMember();
  return { signedBy: me.id, signedDevice: thisDevice(me)?.id ?? "", signedAt: Date.now() };
}
