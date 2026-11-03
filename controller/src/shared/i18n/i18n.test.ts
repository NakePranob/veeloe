import { afterEach, beforeEach, expect, test } from "bun:test";
import { describeError, errorsI18n } from "./errors/describe-error";
import { i18n, initI18n } from "./instance";
import { pickLanguage } from "./language";
import { PluralRules } from "./plural-rules";

beforeEach(() => {
  initI18n(
    {
      th: { errors: errorsI18n.th, sample: { thaiOnly: "ไทย" } },
      en: { errors: errorsI18n.en, sample: { onlyEnglish: "English", thaiOnly: "Thai" } },
    },
    "th",
  );
});

test("the first supported language of the device wins", () => {
  expect(pickLanguage(["th"])).toBe("th");
  expect(pickLanguage(["fr", "th", "en"])).toBe("th");
  expect(pickLanguage(["fr", "en", "th"])).toBe("en");
});

test("a device with no supported language starts in English", () => {
  expect(pickLanguage(["fr"])).toBe("en");
  expect(pickLanguage([null])).toBe("en");
  expect(pickLanguage([])).toBe("en");
});

test("a key the language lacks falls back to English, never the key", () => {
  const t = i18n.getFixedT("th", "sample" as never) as (key: string) => string;
  expect(t("thaiOnly")).toBe("ไทย");
  expect(t("onlyEnglish")).toBe("English");
});

test("a known code gets its words in the language picked", async () => {
  expect(describeError({ code: "hub.machine_offline" })).toBe(errorsI18n.th["hub.machine_offline"]);
  await i18n.changeLanguage("en");
  expect(describeError({ code: "hub.machine_offline" })).toBe(errorsI18n.en["hub.machine_offline"]);
});

test("every code the Hub sends today has words in both languages", () => {
  for (const code of ["hub.machine_offline", "hub.machine_taken", "hub.pairing_invalid", "hub.route_not_allowed", "hub.sender_mismatch"]) {
    expect(errorsI18n.th).toHaveProperty([code]);
    expect(errorsI18n.en).toHaveProperty([code]);
  }
});

test("an unknown code gets the general words with the code in them", async () => {
  expect(describeError({ code: "runtime.brand_new" })).toBe("เกิดข้อผิดพลาด (runtime.brand_new)");
  await i18n.changeLanguage("en");
  expect(describeError({ code: "runtime.brand_new" })).toBe("Something went wrong (runtime.brand_new)");
});

test("a code that is only the front of a known one is still unknown", () => {
  expect(describeError({ code: "hub" })).toBe("เกิดข้อผิดพลาด (hub)");
});

test("a sender's params cannot change the language", () => {
  expect(describeError({ code: "hub.machine_offline", params: { lng: "en" } })).toBe(errorsI18n.th["hub.machine_offline"]);
});

const nativePluralRules = Intl.PluralRules;
afterEach(() => {
  (Intl as { PluralRules: unknown }).PluralRules = nativePluralRules;
});

test("without Intl.PluralRules, as on Hermes, Thai and English still pick their own plural form", () => {
  // @ts-expect-error Removed on purpose, as Hermes has none.
  delete Intl.PluralRules;
  initI18n(
    {
      th: { sample: { agents_other: "Agent {{count}} ตัว" } },
      en: { sample: { agents_one: "One Agent", agents_other: "{{count}} Agents" } },
    },
    "th",
  );
  const inLanguage = (language: string) => i18n.getFixedT(language, "sample" as never) as (key: string, options: { count: number }) => string;
  expect(inLanguage("th")("agents", { count: 1 })).toBe("Agent 1 ตัว");
  expect(inLanguage("en")("agents", { count: 1 })).toBe("One Agent");
  expect(inLanguage("en")("agents", { count: 2 })).toBe("2 Agents");
});

test("the plural rules agree with the real ones for our languages", () => {
  for (const language of ["th", "en"]) {
    const ours = new PluralRules(language);
    const real = new nativePluralRules(language);
    for (const count of [0, 1, 2, 5, 21, 100]) expect(ours.select(count)).toBe(real.select(count) as "one" | "other");
  }
});
