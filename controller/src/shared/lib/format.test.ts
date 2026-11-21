import { expect, test } from "bun:test";
import { formatList, formatTokens } from "./format";

test("tokens keep their short shape and take the language's decimal sign", () => {
  expect(formatTokens(15_300_000, "en")).toBe("15.3M");
  expect(formatTokens(2_000_000, "en")).toBe("2M");
  expect(formatTokens(15_300_000, "de")).toBe("15,3M");
  expect(formatTokens(300_400, "th")).toBe("300K");
  expect(formatTokens(999, "th")).toBe("999");
});

test("a list is joined by the language, not by a comma written into the code", () => {
  expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
  expect(formatList(["a"], "en")).toBe("a");
});
