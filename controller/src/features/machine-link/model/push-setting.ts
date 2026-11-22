import { useLiveQuery, type Database } from "../../../shared/db";

// The switch alone, apart from push.ts, so a screen can show it without loading expo-notifications (8310a96).

/** Off until the Expo project, credentials, and real-device QA are all ready. */
export const PUSH_READY = false;

/** This Controller's own switch; the other devices of the Member keep theirs (ADR 0044). */
export async function savePushEnabled(database: Database, enabled: boolean) {
  await database.write(["device_setting"], ({ run }) => run("INSERT INTO device_setting (key, value) VALUES ('push', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [enabled ? "on" : "off"]));
}

export function usePushEnabled() {
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'push'", [], ["device_setting"]);
  return (saved?.[0]?.value ?? "on") !== "off";
}
