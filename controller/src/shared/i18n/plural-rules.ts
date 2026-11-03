const CATEGORIES: Record<string, string[]> = { th: ["other"], en: ["one", "other"] };

/**
 * Hermes has no Intl.PluralRules, and without it i18next treats every language
 * as one/other, so Thai with a count of 1 asks for a `_one` it does not have and
 * falls back to English. i18next only calls these two methods.
 * ponytail: our two languages only; a language with more forms needs its rule here, or the intl-pluralrules package.
 */
export class PluralRules {
  private categories: string[];

  constructor(language: string) {
    const categories = CATEGORIES[language];
    if (!categories) throw new RangeError(`No plural rule for ${language}`);
    this.categories = categories;
  }

  select(count: number) {
    return count === 1 && this.categories.includes("one") ? "one" : "other";
  }

  resolvedOptions() {
    return { pluralCategories: [...this.categories] };
  }
}

export function installPluralRules() {
  (Intl as { PluralRules: unknown }).PluralRules ??= PluralRules;
}
