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
};

export const LIST_MACHINES = "SELECT * FROM machine ORDER BY paired_at, id";

/** The same Machine paired again after `veeloe unpair` has a new key and id, so this only replaces a repeat. */
export function saveMachine(database: Database, machine: Machine) {
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
