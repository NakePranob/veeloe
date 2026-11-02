import { getAgent, getAgents, subscribeMachines, type Agent } from "../../../entities/agent";
import { addMember, can, getMembers, removeMember, setGrant, updateMember, type Grant, type Member } from "../../../entities/member";
import { createInvitation, getInvitation, getInvitations, statusOf, updateInvitation, type Invitation, type InviteLevel } from "../../../entities/invitation";
import { FROZEN_MESSAGE, isFrozen } from "../../../entities/account";
import { shortCode } from "../../../shared/lib";
import { authenticate } from "../../../shared/ui";

// The rules of who joins, who may do what to whom, and what a Runtime would check (ADR 0010,
// 0031, 0053, 0059). Each action returns why it was refused, or null when it went through.
export type Refusal = string | null;

const CANCELLED = "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";

export const owners = () => getMembers().filter((member) => member.owner && !member.removed);

export function manageableAgents(member: Member): Agent[] {
  return getAgents().filter((agent) => can(member, agent.id, "manage"));
}

// An Owner, or someone with Manage on at least one Agent (ADR 0059).
export function canInvite(member: Member) {
  return !member.removed && (member.owner || manageableAgents(member).length > 0);
}

// A name is unique among the people in the Workspace and the names already promised in
// a link that is still open (ADR 0053).
export function nameError(name: string, exceptMember?: string, exceptInvitation?: string): Refusal {
  const clean = name.trim();
  if (!clean) return "ใส่ชื่อก่อน";
  const same = (other: string) => other.trim().toLowerCase() === clean.toLowerCase();
  if (getMembers().some((member) => !member.removed && member.id !== exceptMember && same(member.name))) return "มีคนใช้ชื่อนี้ใน Workspace แล้ว ชื่อห้ามซ้ำ";
  if (getInvitations().some((invitation) => invitation.id !== exceptInvitation && statusOf(invitation) === "open" && same(invitation.name))) return "มี Invitation ที่ยังไม่ใช้ตั้งชื่อนี้ไว้แล้ว";
  return null;
}

export async function createInvite(issuer: Member, name: string, grants: Record<string, InviteLevel>): Promise<Refusal> {
  if (isFrozen(issuer.id)) return FROZEN_MESSAGE;
  if (!canInvite(issuer)) return "ต้องเป็น Owner หรือมี Manage ที่ Agent อย่างน้อยหนึ่งตัวถึงจะเชิญได้";
  const bad = Object.keys(grants).find((agentId) => !can(issuer, agentId, "manage"));
  if (bad) return `แนบ Grant ได้เฉพาะ Agent ที่คุณมี Manage แต่ไม่มี Manage ที่ ${getAgent(bad)?.name ?? bad}`;
  const error = nameError(name);
  if (error) return error;
  if (Object.keys(grants).length && !(await authenticate(`แนบ Grant ให้ ${name.trim()} ใน Invitation`))) return CANCELLED;
  createInvitation({ name: name.trim(), issuer: issuer.id, grants });
  return null;
}

// The invitee opens the link on their phone: it makes a key and asks to join. `swapped`
// simulates a Hub that put its own key in front of the issuer (ADR 0006, 0031).
export function openLink(id: string, swapped: boolean): Refusal {
  const invitation = getInvitation(id);
  if (!invitation) return "ไม่พบลิงก์นี้";
  const status = statusOf(invitation);
  if (status === "used") return "ลิงก์นี้ใช้แล้ว ลิงก์ใช้ได้ครั้งเดียว";
  if (status === "expired") return "ลิงก์นี้หมดอายุแล้ว ลิงก์ใช้ได้ 24 ชั่วโมง ให้คนที่เชิญสร้างใหม่";
  if (status === "refused") return "ลิงก์นี้ถูกยกเลิกแล้ว";
  if (invitation.stage !== "link") return "ลิงก์นี้ถูกเปิดไปแล้ว ลิงก์ใช้ได้ครั้งเดียว";
  const key = `ed25519:${invitation.token}`;
  updateInvitation(id, { stage: "opened", key, seenKey: swapped ? `ed25519:hub-${invitation.token}` : key });
  return null;
}

export const codesOf = (invitation: Invitation) => ({
  invitee: invitation.key ? shortCode(invitation.key) : [],
  issuer: invitation.seenKey ? shortCode(invitation.seenKey) : [],
});

// The issuer says whether the codes match. Only a match, and their own authentication, signs the certificate.
export async function compareCodes(id: string, matches: boolean): Promise<Refusal> {
  const invitation = getInvitation(id);
  if (!invitation || invitation.stage !== "opened") return "คำขอนี้ไม่รอการเทียบรหัสแล้ว";
  if (statusOf(invitation) === "expired") return "Invitation หมดอายุแล้ว";
  const { invitee, issuer } = codesOf(invitation);
  if (!matches) {
    updateInvitation(id, { stage: "refused", refusal: "คนที่เชิญเทียบรหัสแล้วไม่ตรง จึงไม่เซ็นรับรอง กุญแจนี้อาจถูกสลับระหว่างทาง" });
    return null;
  }
  if (invitee.join() !== issuer.join()) {
    updateInvitation(id, { stage: "refused", refusal: "รหัสสองฝั่งไม่ตรงกัน จึงไม่เซ็นรับรอง กุญแจนี้อาจถูกสลับระหว่างทาง" });
    return "รหัสสองฝั่งไม่ตรงกันจริง จึงไม่เซ็นรับรอง";
  }
  if (!(await authenticate(`เซ็นรับรองกุญแจของ ${invitation.name} เข้า Workspace`))) return CANCELLED;
  updateInvitation(id, { stage: "signed" });
  settle();
  return null;
}

// Machines whose Runtime must vouch for a Manager's certificate: those of the Agents
// the Grants name, or of the Agents the Manager runs when none is attached (ADR 0059).
export function neededMachines(invitation: Invitation) {
  const issuer = getMembers().find((member) => member.id === invitation.issuer);
  if (!issuer || issuer.owner) return [];
  const attached = Object.keys(invitation.grants);
  const agents = attached.length ? attached.map((id) => getAgent(id)).filter((agent): agent is Agent => !!agent) : manageableAgents(issuer);
  return [...new Map(agents.map((agent) => [agent.machine.id, agent.machine])).values()];
}

function refuse(id: string, reason: string) {
  updateInvitation(id, { stage: "refused", refusal: reason });
}

// Runs whenever a Machine changes: certificates that waited for a Runtime go through, and
// Grants that waited for their Machine take effect.
export function settle() {
  for (const invitation of getInvitations()) {
    if (invitation.stage === "signed") join(invitation);
    else if (invitation.stage === "joined" && Object.keys(invitation.pending).length) applyPending(invitation);
  }
}

function join(invitation: Invitation) {
  const issuer = getMembers().find((member) => member.id === invitation.issuer);
  if (!issuer || issuer.removed) return refuse(invitation.id, "คนที่เชิญถูกเอาออกจาก Workspace แล้ว");
  const error = nameError(invitation.name, undefined, invitation.id);
  if (error) return refuse(invitation.id, error);
  if (!issuer.owner) {
    // The Runtime checks Manage before it tells the Hub (ADR 0059).
    const lacking = Object.keys(invitation.grants).find((agentId) => !can(issuer, agentId, "manage"));
    if (lacking) return refuse(invitation.id, `Runtime ของ ${getAgent(lacking)?.name ?? lacking} ปฏิเสธ: ${issuer.name} ไม่มี Manage ที่ Agent นี้แล้ว`);
    const machines = neededMachines(invitation);
    if (machines.length && !machines.some((machine) => machine.online)) return;
  }
  const applied: Record<string, Grant> = {};
  const pending: Record<string, InviteLevel> = {};
  for (const [agentId, level] of Object.entries(invitation.grants)) {
    if (getAgent(agentId)?.machine.online) applied[agentId] = level;
    else pending[agentId] = level;
  }
  const member = addMember(invitation.name, invitation.issuer, applied);
  updateInvitation(invitation.id, { stage: "joined", joinedAs: member.id, pending });
}

function applyPending(invitation: Invitation) {
  const issuer = getMembers().find((member) => member.id === invitation.issuer);
  const pending = { ...invitation.pending };
  for (const [agentId, level] of Object.entries(invitation.pending)) {
    const agent = getAgent(agentId);
    if (!agent) delete pending[agentId];
    else if (agent.machine.online) {
      // Revoked meanwhile, the Runtime would refuse it.
      if (can(issuer, agentId, "manage") && invitation.joinedAs) setGrant(invitation.joinedAs, agentId, level);
      delete pending[agentId];
    }
  }
  if (Object.keys(pending).length !== Object.keys(invitation.pending).length) updateInvitation(invitation.id, { pending });
}

// ponytail: the Hub tells the Runtime a Machine is back; here a change of any Machine does.
subscribeMachines(settle);

export async function setOwner(actor: Member, targetId: string, owner: boolean): Promise<Refusal> {
  const target = getMembers().find((member) => member.id === targetId);
  if (isFrozen(actor.id)) return FROZEN_MESSAGE;
  if (!actor.owner) return "เฉพาะ Owner ที่เลื่อนหรือปลด Owner ได้";
  if (!target || target.removed) return "ไม่พบ Member คนนี้";
  if (target.owner === owner) return null;
  if (!owner && owners().length <= 1) return "Owner คนสุดท้ายออกจากตำแหน่งไม่ได้ เลื่อนคนอื่นเป็น Owner ก่อน";
  if (!(await authenticate(owner ? `เลื่อน ${target.name} เป็น Owner` : `ปลด ${target.name} จากการเป็น Owner`))) return CANCELLED;
  updateMember(targetId, { owner });
  return null;
}

export function renameMember(actor: Member, targetId: string, name: string): Refusal {
  if (actor.id !== targetId && !actor.owner) return "เปลี่ยนชื่อได้เฉพาะของตัวเอง หรือโดย Owner";
  const error = nameError(name, targetId);
  if (error) return error;
  updateMember(targetId, { name: name.trim() });
  return null;
}

// Changing a Grant is signed by an Owner or someone with Manage on that Agent (ADR 0010).
export async function changeGrant(actor: Member, targetId: string, agentId: string, level: Grant | null): Promise<Refusal> {
  const target = getMembers().find((member) => member.id === targetId);
  const agent = getAgent(agentId);
  if (isFrozen(actor.id)) return FROZEN_MESSAGE;
  if (!target || target.removed || !agent) return "ไม่พบ Member หรือ Agent";
  if (!can(actor, agentId, "manage")) return `ต้องมี Manage ที่ ${agent.name} ถึงจะแจกหรือถอน Grant ได้`;
  if (target.owner) return "Owner มี Manage ทุก Agent อยู่แล้ว ปลดจาก Owner ก่อนถ้าจะกำหนดเอง";
  if (!(await authenticate(level ? `ให้ ${target.name} ${level} ที่ ${agent.name}` : `ถอน Grant ของ ${target.name} ที่ ${agent.name}`))) return CANCELLED;
  setGrant(targetId, agentId, level);
  return null;
}

// Why this Member cannot be removed; null when they can (ADR 0031, 0059).
export function removalRefusal(actor: Member, target: Member): Refusal {
  if (!actor.owner) return "เฉพาะ Owner ที่ลบ Member ได้";
  if (target.removed) return "Member คนนี้ถูกลบไปแล้ว";
  if (target.owner && owners().length <= 1) return "Owner คนสุดท้ายออกจาก Workspace ไม่ได้ เลื่อนคนอื่นเป็น Owner ก่อน";
  return null;
}

// Revokes every key and Grant and cancels their open links. The caller stops their Turns.
export async function removeMemberNow(actor: Member, targetId: string): Promise<Refusal> {
  const target = getMembers().find((member) => member.id === targetId);
  if (isFrozen(actor.id)) return FROZEN_MESSAGE;
  if (!target) return "ไม่พบ Member คนนี้";
  const why = removalRefusal(actor, target);
  if (why) return why;
  if (!(await authenticate(`ถอนกุญแจทุกเครื่องและ Grant ทั้งหมดของ ${target.name} แล้วเอาออกจาก Workspace`))) return CANCELLED;
  removeMember(targetId);
  for (const invitation of getInvitations()) {
    if (invitation.issuer === targetId && invitation.stage !== "joined" && invitation.stage !== "refused") refuse(invitation.id, "คนที่เชิญถูกเอาออกจาก Workspace");
    if (invitation.joinedAs === targetId) updateInvitation(invitation.id, { pending: {} });
  }
  return null;
}

