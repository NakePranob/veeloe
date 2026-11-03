export const LANGUAGES = ["th", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (code: string | null | undefined): code is Language => LANGUAGES.includes(code as Language);

/** The first of the device's languages we support; English when there is none (ADR 0065). */
export function pickLanguage(deviceLanguages: (string | null)[]): Language {
  return deviceLanguages.find(isLanguage) ?? "en";
}
