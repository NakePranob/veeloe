import { buildInvitationLink, checkLinkRequestProof, linkingProof, shortCode, signCertificate, toBase64url, type GrantLevel, type HubInvitationRequest, type InvitationLink } from "@veeloe/protocol-ts";
import type { Machine } from "../../../entities/machine";
import type { Database } from "../../../shared/db";
import { postCertificate, postMember, type HubAnswer } from "../../../shared/hub-client";

export const INVITATION_TOPIC = "invitation";

/** One Agent's level for whoever this Invitation lets in. */
export type Grant = { machine: string; agent: string; level: GrantLevel };

/** An Invitation this device opened, as kept here (ADR 0059). */
export type Invitation = {
  id: string;
  hub_url: string;
  workspace_id: string;
  member_id: string;
  secret: string;
  link: string;
  max_members: number;
  expires_at: number;
  grants: string;
  /** A group everyone let in joins, and a title shown after their name (ADR 0091). */
  group_id: string | null;
  title: string | null;
  joined: string;
  closed_at: number | null;
  created_at: number;
};

/** Someone who asked in and whose proof checked out: what the inviter compares and lets in, or not. */
export type Ask = { key: string; name: string; code: string };

/** Someone let in: their new Member id, so the same key is never let in twice. */
export type Joined = { key: string; member: string; name: string };

export const LIST_INVITATIONS = "SELECT * FROM invitation ORDER BY created_at DESC";

type Authenticate = (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>;

/**
 * A new Invitation's link and the certificate that opens it at the Hub: random id and secret, the inviter's key,
 * and how long it lasts. Nothing is sent: `open` does that once the inviter authenticated.
 */
export function draftInvitation({ hub, ownKey, from, hours, now = Date.now }: { hub: string; ownKey: string; from: string; hours: number; now?: () => number }) {
  const link: InvitationLink = {
    hub,
    id: toBase64url(crypto.getRandomValues(new Uint8Array(16))),
    secret: toBase64url(crypto.getRandomValues(new Uint8Array(32))),
    by: ownKey,
    from: from.trim(),
    expires: Math.floor(now() / 1000 + hours * 3600),
  };
  return { link, text: buildInvitationLink(link) };
}

/** Opens the Invitation at the Hub, signed after a fresh authentication (ADR 0012); null when the inviter did not. */
export async function openInvitation(
  authenticate: Authenticate,
  { link, max, machine, fetchFn, now = Date.now }: { link: InvitationLink; max: number; machine: Pick<Machine, "workspace_id" | "member_id">; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  let answer: HubAnswer | null = null;
  const done = await authenticate(async (key) => {
    const certificate = signCertificate({ type: "invitation.open", workspace: machine.workspace_id, member: machine.member_id, key: link.by, invitation: link.id, max, expires: link.expires * 1000, at: now() }, key);
    answer = await postCertificate(link.hub, "/invitations", certificate, fetchFn);
  });
  return done ? answer : null;
}

/** Closes it at the Hub: nobody else gets in, whoever already did stays. */
export async function closeInvitation(
  authenticate: Authenticate,
  { link, machine, fetchFn, now = Date.now }: { link: InvitationLink; machine: Pick<Machine, "workspace_id" | "member_id">; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  let answer: HubAnswer | null = null;
  const done = await authenticate(async (key) => {
    const certificate = signCertificate({ type: "invitation.close", workspace: machine.workspace_id, member: machine.member_id, key: link.by, invitation: link.id, at: now() }, key);
    answer = await postCertificate(link.hub, "/invitations/close", certificate, fetchFn);
  });
  return done ? answer : null;
}

/**
 * A request the Hub handed over, once its proof matches the secret: the Hub cannot make one up or swap the key,
 * since it never saw the secret. Anything else, a key let in already, or a link past its time, is nothing.
 */
export function takeRequest(link: InvitationLink, request: HubInvitationRequest, joined: readonly Joined[], now = Date.now()): Ask | null {
  if (request.invitation !== link.id || now > link.expires * 1000) return null;
  if (joined.some((person) => person.key === request.key)) return null;
  if (!checkLinkRequestProof({ secret: link.secret, id: link.id, key: request.key, name: request.name }, request.proof)) return null;
  return { key: request.key, name: request.name.trim(), code: shortCode(request.key) };
}

/** What the new Member's device needs, as text its proof covers: the Machines their Grants are on, on the link's Hub. */
function handoffFor(link: InvitationLink, { workspace, member }: { workspace: string; member: string }, machines: readonly Machine[], grants: readonly Grant[], alsoOn: readonly string[]) {
  const on = new Set([...grants.map((grant) => grant.machine), ...alsoOn]);
  return JSON.stringify({
    workspace,
    member,
    machines: machines.filter((m) => on.has(m.id) && m.hub_url === link.hub).map((m) => ({ id: m.id, key: m.public_key, name: m.name, hub: m.hub_url })),
    keys: [],
  });
}

/**
 * Lets one person in (ADR 0059): signs a new Member for their key, with what their device picks up at the Hub,
 * then sends each Grant to its Machine, which takes it from an Owner or a Manager there. The Machine learns
 * of the Member from the certificate the Hub hands it first. Answers the Hub's word and the Grants that did
 * not go (their Machine is not connected), or null when the inviter did not authenticate.
 */
export async function letIn(
  authenticate: Authenticate,
  {
    link,
    ask,
    machine,
    machines,
    grants,
    setGrant,
    title,
    alsoOn = [],
    fetchFn,
    now = Date.now,
  }: {
    link: InvitationLink;
    ask: Ask;
    machine: Pick<Machine, "workspace_id" | "member_id">;
    machines: readonly Machine[];
    grants: readonly Grant[];
    setGrant: (machine: Machine, body: { agent: string; member: string; level: GrantLevel }) => boolean;
    /** Shown after their name everywhere; grants nothing. */
    title?: string | null;
    /** Machines their device should know besides the Grants', where a group gives them something. */
    alsoOn?: readonly string[];
    fetchFn?: typeof fetch;
    now?: () => number;
  },
): Promise<{ answer: HubAnswer; member: string; unsent: Grant[] } | null> {
  const member = `m_${toBase64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const sent: { answer?: HubAnswer } = {};
  const done = await authenticate(async (key) => {
    const certificate = signCertificate({ type: "member.add", workspace: machine.workspace_id, member, key: ask.key, name: ask.name, ...(title ? { title } : {}), invitation: link.id, at: now() }, key);
    const data = handoffFor(link, { workspace: machine.workspace_id, member }, machines, grants, alsoOn);
    sent.answer = await postMember(link.hub, certificate, { data, proof: linkingProof({ secret: link.secret, key: ask.key, data }) }, fetchFn);
  });
  const hub = sent.answer;
  if (!done || !hub) return null;
  if (!hub.ok) return { answer: hub, member, unsent: [] };
  const unsent = grants.filter((grant) => {
    const on = machines.find((m) => m.id === grant.machine);
    return !on || !setGrant(on, { agent: grant.agent, member, level: grant.level });
  });
  return { answer: hub, member, unsent };
}

export function grantsOf(invitation: Invitation): Grant[] {
  return JSON.parse(invitation.grants) as Grant[];
}

export function joinedOf(invitation: Invitation): Joined[] {
  return JSON.parse(invitation.joined) as Joined[];
}

export function saveInvitation(database: Database, row: Omit<Invitation, "joined" | "closed_at">) {
  return database.write([INVITATION_TOPIC], (tx) =>
    tx.run("INSERT INTO invitation (id, hub_url, workspace_id, member_id, secret, link, max_members, expires_at, grants, group_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      row.id,
      row.hub_url,
      row.workspace_id,
      row.member_id,
      row.secret,
      row.link,
      row.max_members,
      row.expires_at,
      row.grants,
      row.group_id,
      row.title,
      row.created_at,
    ]),
  );
}

/** The requests still waiting on one Invitation, oldest first. */
export const LIST_ASKS = "SELECT key, name, code FROM invitation_request WHERE invitation_id = ? AND refused = 0 ORDER BY at";

/** Keeps a request whose proof checked out; the same key again changes nothing, a refused one included. */
export function saveAsk(database: Database, invitation: string, ask: Ask, at = Date.now()) {
  return database.write([INVITATION_TOPIC], (tx) => tx.run("INSERT OR IGNORE INTO invitation_request (key, invitation_id, name, code, at) VALUES (?, ?, ?, ?, ?)", [ask.key, invitation, ask.name, ask.code, at]));
}

/** Refused: it stays, so the same person asking again does not come back. */
export function refuseAsk(database: Database, key: string) {
  return database.write([INVITATION_TOPIC], (tx) => tx.run("UPDATE invitation_request SET refused = 1 WHERE key = ?", [key]));
}

export function addJoined(database: Database, id: string, person: Joined) {
  return database.write([INVITATION_TOPIC], async (tx) => {
    const [row] = await tx.all<{ joined: string }>("SELECT joined FROM invitation WHERE id = ?", [id]);
    if (!row) return;
    const joined = JSON.parse(row.joined) as Joined[];
    await tx.run("UPDATE invitation SET joined = ? WHERE id = ?", [JSON.stringify([...joined, person]), id]);
    await tx.run("DELETE FROM invitation_request WHERE key = ?", [person.key]);
  });
}

export function markClosed(database: Database, id: string, at = Date.now()) {
  return database.write([INVITATION_TOPIC], (tx) => tx.run("UPDATE invitation SET closed_at = ? WHERE id = ? AND closed_at IS NULL", [at, id]));
}
