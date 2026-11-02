import { createStore } from "../../../shared/lib";

export type InviteLevel = "use" | "approve" | "manage";

// link: waiting for the invitee to open it. opened: the invitee made a key and both screens
// show its code. signed: the issuer vouched for the key; a Manager's certificate still waits
// for a Runtime (ADR 0059). joined and refused end it.
export type InviteStage = "link" | "opened" | "signed" | "joined" | "refused";
export type InviteStatus = "open" | "expired" | "used" | "refused";

export interface Invitation {
  id: string;
  token: string;
  // Set by the issuer, so the invitee cannot call themselves someone else (ADR 0053).
  name: string;
  issuer: string;
  // Only on Agents the issuer has Manage on (ADR 0059).
  grants: Record<string, InviteLevel>;
  createdAt: number;
  expiresAt: number;
  stage: InviteStage;
  // The key the invitee made, and the key the issuer's screen was given; a Hub that swaps
  // keys makes them differ, and so their codes (ADR 0031).
  key?: string;
  seenKey?: string;
  refusal?: string;
  joinedAs?: string;
  // Grants that wait for their Machine to be on (ADR 0059).
  pending: Record<string, InviteLevel>;
}

const HOUR = 3_600_000;
export const INVITE_TTL = 24 * HOUR;

const invitations = createStore<Invitation[]>([]);

export const useInvitations = invitations.use;
export const getInvitations = invitations.get;
export const subscribeInvitations = invitations.subscribe;

export function statusOf(invitation: Invitation, now = Date.now()): InviteStatus {
  if (invitation.stage === "joined") return "used";
  if (invitation.stage === "refused") return "refused";
  if (invitation.stage !== "signed" && now >= invitation.expiresAt) return "expired";
  return "open";
}

let counter = 0;

export function createInvitation(input: Pick<Invitation, "name" | "issuer" | "grants">) {
  const now = Date.now();
  const invitation: Invitation = {
    ...input,
    id: `inv_${++counter}`,
    token: Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6),
    createdAt: now,
    expiresAt: now + INVITE_TTL,
    stage: "link",
    pending: {},
  };
  invitations.set((all) => [invitation, ...all]);
  return invitation;
}

export function getInvitation(id: string) {
  return invitations.get().find((invitation) => invitation.id === id);
}

export function updateInvitation(id: string, patch: Partial<Invitation>) {
  invitations.set((all) => all.map((invitation) => (invitation.id === id ? { ...invitation, ...patch } : invitation)));
}
