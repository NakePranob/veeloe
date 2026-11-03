import i18next, { type Resource } from "i18next";
import type { Language } from "./language";
import { installPluralRules } from "./plural-rules";

export const i18n = i18next.createInstance();

/** Synchronous, so the very first screen has its words. */
export function initI18n(resources: Resource, language: Language) {
  installPluralRules();
  void i18n.init({
    resources,
    lng: language,
    fallbackLng: "en",
    defaultNS: false,
    initAsync: false,
    // React Native draws text, never HTML, so there is nothing to escape.
    interpolation: { escapeValue: false },
  });
}
