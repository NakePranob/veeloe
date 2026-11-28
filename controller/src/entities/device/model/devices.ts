import { revokedWith, verifyCertificate, type DeviceLink } from "@veeloe/protocol-ts";
import type { Database } from "../../../shared/db";

export const DEVICE_TOPIC = "device";
export const MEMBER_TOPIC = "member";

/** A Member let in through an Invitation, and whether an Owner took them out since. */
export type Member = { id: string; workspace_id: string; name: string; added_by: string; added_at: number; removed_at: number | null };

export const LIST_MEMBERS = "SELECT * FROM member ORDER BY added_at, id";

/** One Agent's Grant to one Member. */
export type AgentGrant = { agent_id: string; member_id: string; level: "use" | "approve" | "manage" };

/** Replaces one Agent's Grants with what its Machine listed. */
export function saveGrants(database: Database, agent: string, grants: readonly { member: string; level: AgentGrant["level"] }[]) {
  return database.write([MEMBER_TOPIC], async (transaction) => {
    await transaction.run("DELETE FROM agent_grant WHERE agent_id = ?", [agent]);
    for (const grant of grants) await transaction.run("INSERT INTO agent_grant (agent_id, member_id, level) VALUES (?, ?, ?)", [agent, grant.member, grant.level]);
  });
}

/** One of the Member's Controllers. `linked_by` is null for the first device, which no certificate names. */
export type Device = { key: string; member_id: string; name: string; linked_by: string | null; linked_at: number | null; revoked_at: number | null };

export const LIST_DEVICES = "SELECT * FROM device ORDER BY coalesce(linked_at, 0), key";

// A link this recent is news to tell the Owner about; an older one is history this device catches up on.
const NEWS_MS = 10 * 60 * 1000;

/**
 * The device list as the certificates say, for showing only: the Runtime decides
 * which keys it trusts, and a certificate whose signature fails is dropped here
 * too. This device is in it from the start, as the first device until a link
 * names it. Answers the new links that another device made, to tell the Owner.
 */
export function saveCertificates(database: Database, { member, own, ownName, now = Date.now() }: { member: string; own: string; ownName: string; now?: number }, certificates: unknown[]): Promise<DeviceLink[]> {
  return database.write([DEVICE_TOPIC, MEMBER_TOPIC], async (transaction) => {
    const news: DeviceLink[] = [];
    await transaction.run("INSERT OR IGNORE INTO device (key, member_id, name) VALUES (?, ?, ?)", [own, member, ownName]);
    for (const certificate of certificates) {
      const body = verifyCertificate(certificate);
      // Other Members of the Workspace: who came in, and who was taken out.
      if (body?.type === "member.add") {
        await transaction.run("INSERT OR IGNORE INTO member (id, workspace_id, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)", [body.member, body.workspace, body.name, body.by, body.at]);
        continue;
      }
      if (body?.type === "member.remove") {
        await transaction.run("UPDATE member SET removed_at = ? WHERE id = ? AND removed_at IS NULL", [body.at, body.member]);
        continue;
      }
      if (!body || body.member !== member) continue;
      if (body.type === "device.link") {
        const [row] = await transaction.all<{ linked_by: string | null }>("SELECT linked_by FROM device WHERE key = ?", [body.key]);
        if (row?.linked_by) continue;
        await transaction.run("INSERT INTO device (key, member_id, name, linked_by, linked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET name = excluded.name, linked_by = excluded.linked_by, linked_at = excluded.linked_at", [
          body.key,
          member,
          body.name,
          body.by,
          body.at,
        ]);
        if (body.by !== own && body.key !== own && body.at > now - NEWS_MS) news.push(body);
      } else if (body.type === "device.revoke") {
        const links = await transaction.all<{ key: string; by: string }>("SELECT key, linked_by AS by FROM device WHERE linked_by IS NOT NULL");
        for (const key of revokedWith(body.key, links, body.keep)) await transaction.run("UPDATE device SET revoked_at = ? WHERE key = ? AND revoked_at IS NULL", [body.at, key]);
      }
    }
    return news;
  });
}

/** Names the old device knew for the Member's keys, from a handoff whose proof checked out. Never over a name already kept. */
export function saveDeviceNames(database: Database, member: string, keys: { key: string; name?: string }[]) {
  return database.write([DEVICE_TOPIC], async (transaction) => {
    for (const { key, name = "" } of keys) {
      await transaction.run("INSERT OR IGNORE INTO device (key, member_id, name) VALUES (?, ?, ?)", [key, member, name]);
      await transaction.run("UPDATE device SET name = ? WHERE key = ? AND name = ''", [name, key]);
    }
  });
}

/** Rename a Controller on this device. Revoked Controllers keep their history name. */
export function renameDevice(database: Database, key: string, name: string) {
  return database.write([DEVICE_TOPIC], async (transaction) => {
    const [row] = await transaction.all<{ revoked_at: number | null }>("SELECT revoked_at FROM device WHERE key = ?", [key]);
    if (!row || row.revoked_at !== null) return false;
    await transaction.run("UPDATE device SET name = ? WHERE key = ? AND revoked_at IS NULL", [name.trim(), key]);
    return true;
  });
}

export function listDevices(database: Database) {
  return database.query<Device>(LIST_DEVICES);
}

/** The keys a revocation of `device` takes with it, given what is kept: it, and what it linked, down the tree. */
export function droppedWith(devices: readonly Device[], device: string, keep: readonly string[]): string[] {
  const links = devices.flatMap((d) => (d.linked_by && d.revoked_at === null ? [{ key: d.key, by: d.linked_by }] : []));
  return revokedWith(device, links, keep);
}

/**
 * Why a name cannot be a device's: empty, or the name of another of this Member's devices still in use.
 * `except` is the device being renamed, whose own name is no clash.
 */
export function nameProblem(name: string, devices: readonly Device[], except?: string): "empty" | "taken" | null {
  const chosen = name.trim();
  if (!chosen) return "empty";
  return devices.some((d) => d.key !== except && d.revoked_at === null && d.name === chosen) ? "taken" : null;
}
