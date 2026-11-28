import type { Database } from "../../../shared/db";

export const MACHINE_TOPIC = "machine";

/** A Machine this Controller paired with. The columns are the database's own. */
export type Machine = {
  id: string;
  public_key: string;
  name: string;
  hub_url: string;
  workspace_id: string;
  member_id: string;
  paired_at: number;
  /** The Machine's Egress as it last said, a JSON list of domains. */
  egress: string;
  /** 1 when this Member is an Owner of it, 0 when a Grant is all they hold there (ADR 0010). */
  owner?: number;
  /** When it last answered a usage request, for "ข้อมูลเมื่อ" (`usage-history`); null before the first. */
  usage_fetched_at?: number | null;
};

/** The domains in a Machine's Egress, as a list. */
export function egressOf(machine: Pick<Machine, "egress">): string[] {
  try {
    const list: unknown = JSON.parse(machine.egress);
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

export const LIST_MACHINES = "SELECT * FROM machine ORDER BY paired_at, id";

/** The same Machine paired again after `veeloe unpair` has a new key and id, so this only replaces a repeat. */
export function saveMachine(database: Database, machine: Omit<Machine, "egress" | "owner">) {
  return database.write([MACHINE_TOPIC], (transaction) =>
    transaction.run("INSERT OR REPLACE INTO machine (id, public_key, name, hub_url, workspace_id, member_id, paired_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      machine.id,
      machine.public_key,
      machine.name,
      machine.hub_url,
      machine.workspace_id,
      machine.member_id,
      machine.paired_at,
    ]),
  );
}

/** What the Machine said its Egress is, in its own signed `agent.listed`. */
/** Whether this Member owns any of these Machines, so may create Agents (ADR 0010). */
export function ownsAny(machines: readonly Pick<Machine, "owner">[] | undefined) {
  return (machines ?? []).some((machine) => machine.owner !== 0);
}

/** Whether this Member is an Owner there, as its Agent list said. */
export function saveOwner(database: Database, machineId: string, owner: boolean) {
  return database.write([MACHINE_TOPIC], (transaction) => transaction.run("UPDATE machine SET owner = ? WHERE id = ?", [owner ? 1 : 0, machineId]));
}

export function saveEgress(database: Database, machineId: string, egress: string[]) {
  return database.write([MACHINE_TOPIC], (transaction) => transaction.run("UPDATE machine SET egress = ? WHERE id = ?", [JSON.stringify(egress), machineId]));
}
