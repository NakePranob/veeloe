import { createKeyI18n } from "../../pages/create-key";
import { lockI18n } from "../../pages/lock";
import { otherTabI18n } from "../../pages/other-tab";
import { homeI18n } from "../../pages/home";
import { settingsI18n } from "../../pages/settings";
import { storageUnavailableI18n } from "../../pages/storage-unavailable";
import { errorsI18n, type Language } from "../../shared/i18n";

// One namespace per slice. Only this layer may see them all, since shared cannot import up.
const slices = {
  errors: errorsI18n,
  "create-key": createKeyI18n,
  home: homeI18n,
  lock: lockI18n,
  "other-tab": otherTabI18n,
  settings: settingsI18n,
  "storage-unavailable": storageUnavailableI18n,
};

const inLanguage = <L extends Language>(language: L) => Object.fromEntries(Object.entries(slices).map(([namespace, words]) => [namespace, words[language]]));

export const resources = { th: inLanguage("th"), en: inLanguage("en") };

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: false;
    resources: { [Namespace in keyof typeof slices]: (typeof slices)[Namespace]["en"] };
  }
}
