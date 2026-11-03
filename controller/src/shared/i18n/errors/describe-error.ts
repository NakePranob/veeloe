import { i18n } from "../instance";
import en from "./en.json";
import th from "./th.json";

export const errorsI18n = { th, en };

type ErrorBody = { code: string; params?: Record<string, string | number | boolean> };

/**
 * The words for a code from a Runtime or the Hub, whose vocabulary only grows
 * (ADR 0023, 0065). `_` cannot start a code, so none can land on the fallback.
 * Keys hold the dots of the code as they are, and values go in through `replace`
 * because a sender's params must not reach i18next as options such as `lng`.
 */
export function describeError({ code, params }: ErrorBody): string {
  const t = i18n.getFixedT(null, "errors");
  if (!i18n.exists(code, { ns: "errors", keySeparator: false })) return t("_unknown", { code });
  return t(code as never, { keySeparator: false, replace: params }) as string;
}
