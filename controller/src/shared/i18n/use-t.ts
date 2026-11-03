import type { Namespace } from "i18next";
import { useMemo, useSyncExternalStore } from "react";
import { i18n } from "./instance";

function subscribe(onChange: () => void) {
  i18n.on("languageChanged", onChange);
  return () => i18n.off("languageChanged", onChange);
}

const currentLanguage = () => i18n.language;

export function useLanguage() {
  return useSyncExternalStore(subscribe, currentLanguage);
}

/** The words of one slice, in the language picked now. Re-renders when it changes. */
export function useT<N extends Namespace>(namespace: N) {
  const language = useLanguage();
  return useMemo(() => i18n.getFixedT(language, namespace), [language, namespace]);
}
