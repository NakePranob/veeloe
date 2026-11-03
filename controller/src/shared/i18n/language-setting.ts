import type { Database } from "../db";
import { i18n } from "./instance";
import { isLanguage, type Language } from "./language";

/** Puts the language this device picked on screen, if it ever picked one (ADR 0065). */
export async function applySavedLanguage(database: Database) {
  const [row] = await database.query<{ value: string }>("SELECT value FROM device_setting WHERE key = 'language'");
  if (isLanguage(row?.value)) await i18n.changeLanguage(row.value);
}

export async function saveLanguage(database: Database, language: Language) {
  await database.write(["device_setting"], ({ run }) => run("INSERT INTO device_setting (key, value) VALUES ('language', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [language]));
  await i18n.changeLanguage(language);
}
