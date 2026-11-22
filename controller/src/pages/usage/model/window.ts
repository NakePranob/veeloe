import { useLiveQuery, type Database } from "../../../shared/db";

/** The windows the page offers, in Budget days. */
export const USAGE_WINDOWS = [1, 3, 7, 30] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];
export const DEFAULT_USAGE_WINDOW: UsageWindow = 7;

export const isUsageWindow = (value: number): value is UsageWindow => (USAGE_WINDOWS as readonly number[]).includes(value);

/** The window picked on this device, or the default until one is. */
export function useUsageWindow(): UsageWindow {
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'usage.window'", [], ["device_setting"]);
  const days = Number(saved?.[0]?.value);
  return isUsageWindow(days) ? days : DEFAULT_USAGE_WINDOW;
}

/** Remembered on this device, like the language. */
export function saveUsageWindow(database: Database, days: UsageWindow) {
  return database.write(["device_setting"], ({ run }) => run("INSERT INTO device_setting (key, value) VALUES ('usage.window', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [String(days)]));
}
