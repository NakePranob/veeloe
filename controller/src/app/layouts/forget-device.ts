import type { Database } from "../../shared/db";
import { keySession } from "../../shared/keystore";

// Everything but this device's own settings, such as its language.
const TABLES = ["machine", "agent", "task", "task_event", "pending_message", "device"];

/**
 * This key was revoked (ADR 0031): the device forgets its Machines, Tasks and key and
 * goes back to creating one. A stolen device may never open the app, so this is
 * tidying up, not what keeps it out; the Hub and the Runtime do that.
 */
export async function forgetThisDevice(database: Database) {
  await database.write(["machine", "agent", "task", "device"], async (transaction) => {
    for (const table of TABLES) await transaction.run(`DELETE FROM ${table}`);
  });
  await keySession.forget();
}
