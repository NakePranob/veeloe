import { getLocales } from "expo-localization";
import { pickLanguage } from "./language";

export const deviceLanguage = () => pickLanguage(getLocales().map((locale) => locale.languageCode));
