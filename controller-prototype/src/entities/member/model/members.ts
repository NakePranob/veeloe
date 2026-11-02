import { createStore } from "../../../shared/lib";

export type Grant = "use" | "approve" | "manage";
export const GRANT_LABEL: Record<Grant, string> = { use: "Use", approve: "Approve", manage: "Manage" };
const RANK: Record<Grant, number> = { use: 1, approve: 2, manage: 3 };

// One Controller of a Member, known by its key (ADR 0013, 0031).
export interface Device {
  id: string;
  name: string;
  kind: "phone" | "tablet" | "web";
  // Which device signed this one's certificate, and when.
  linkedBy?: string;
  linkedAt: number;
  revoked?: boolean;
}

export interface Member {
  id: string;
  name: string;
  owner: boolean;
  invitedBy?: string;
  lastActiveAt: number;
  grants: Record<string, Grant>;
  devices: Device[];
  // A Member may leave the Workspace by being removed; history keeps the id (ADR 0024, 0053).
  removed?: boolean;
}

const HOUR = 3_600_000;
const now = Date.now();

const members = createStore<Member[]>([
  {
    id: "m_kai",
    name: "Kai",
    owner: true,
    lastActiveAt: now,
    grants: {},
    devices: [
      { id: "d_kai_phone", name: "iPhone ของ Kai", kind: "phone", linkedAt: now - 900 * HOUR },
      { id: "d_kai_web", name: "Safari บน MacBook", kind: "web", linkedBy: "d_kai_phone", linkedAt: now - 300 * HOUR },
    ],
  },
  { id: "m_nok", name: "Nok", owner: false, invitedBy: "m_kai", lastActiveAt: now - 2 * HOUR, grants: { deployer: "use", reviewer: "manage" }, devices: [{ id: "d_nok_phone", name: "Pixel ของ Nok", kind: "phone", linkedAt: now - 200 * HOUR }] },
  { id: "m_mint", name: "Mint", owner: false, invitedBy: "m_kai", lastActiveAt: now - 30 * HOUR, grants: { deployer: "approve" }, devices: [{ id: "d_mint_phone", name: "iPhone ของ Mint", kind: "phone", linkedAt: now - 100 * HOUR }] },
]);

// Who is holding this Controller. The Owner by default; the Demo controls switch it so every
// Grant can be tried from one device.
const current = createStore("m_kai");

export const useMembers = members.use;
export const getMembers = members.get;
export const useCurrentMemberId = current.use;
export const getCurrentMemberId = current.get;
export const setCurrentMember = current.set;

export function useCurrentMember() {
  const id = useCurrentMemberId();
  return useMembers().find((member) => member.id === id) as Member;
}

export function getCurrentMember() {
  return members.get().find((member) => member.id === current.get()) as Member;
}

export function useMember(id: string | undefined) {
  return useMembers().find((member) => member.id === id);
}

export function memberName(id: string | undefined) {
  const member = members.get().find((candidate) => candidate.id === id);
  if (!member) return "Member ของ Workspace เดิม";
  return member.removed ? "อดีต Member" : member.name;
}

// An Owner has Manage on every Agent; a higher level includes the lower ones (CONTEXT.md).
export function can(member: Member | undefined, agentId: string, level: Grant) {
  if (!member || member.removed) return false;
  if (member.owner) return true;
  const grant = member.grants[agentId];
  return !!grant && RANK[grant] >= RANK[level];
}

export function updateMember(id: string, patch: Partial<Member>) {
  members.set((all) => all.map((member) => (member.id === id ? { ...member, ...patch } : member)));
}

export function setGrant(memberId: string, agentId: string, grant: Grant | null) {
  members.set((all) =>
    all.map((member) => {
      if (member.id !== memberId) return member;
      const grants = { ...member.grants };
      if (grant) grants[agentId] = grant;
      else delete grants[agentId];
      return { ...member, grants };
    }),
  );
}

let counter = 0;

export function addMember(name: string, invitedBy: string, grants: Record<string, Grant>) {
  const id = `m_${name.toLowerCase().replace(/\s+/g, "_")}_${++counter}`;
  const member: Member = { id, name, owner: false, invitedBy, lastActiveAt: Date.now(), grants, devices: [{ id: `d_${id}`, name: `มือถือของ ${name}`, kind: "phone", linkedAt: Date.now() }] };
  members.set((all) => [...all, member]);
  return member;
}

// Removing a Member is revoking every key they hold (CONTEXT.md). Their id stays for history.
export function removeMember(id: string) {
  members.set((all) => all.map((member) => (member.id === id ? { ...member, removed: true, grants: {}, owner: false, devices: member.devices.map((device) => ({ ...device, revoked: true })) } : member)));
}

export function addDevice(memberId: string, name: string, kind: Device["kind"], linkedBy: string) {
  const device: Device = { id: `d_${++counter}`, name, kind, linkedBy, linkedAt: Date.now() };
  members.set((all) => all.map((member) => (member.id === memberId ? { ...member, devices: [...member.devices, device] } : member)));
  return device;
}

// Revocation names the certificates this key signed that stay accepted; every other one
// it signed stops working, whatever date it claims (ADR 0031).
export function revokeDevice(memberId: string, deviceId: string, keep: string[]) {
  members.set((all) =>
    all.map((member) =>
      member.id === memberId
        ? { ...member, devices: member.devices.map((device) => (device.id === deviceId || (device.linkedBy === deviceId && !keep.includes(device.id)) ? { ...device, revoked: true } : device)) }
        : member,
    ),
  );
}

// The Controller this demo runs on, per Member: the first key they still hold.
export function thisDevice(member: Member) {
  return member.devices.find((device) => !device.revoked);
}
