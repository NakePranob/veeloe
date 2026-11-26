import { expect, test } from "bun:test";
import { budgetOf } from "./budget";

test("the field takes millions and turns them into a whole number of tokens", () => {
  expect(budgetOf("10")).toEqual({ tokens: 10_000_000, valid: true });
  expect(budgetOf(" 0.01 ")).toEqual({ tokens: 10_000, valid: true });
  expect(budgetOf("0,5")).toEqual({ tokens: 500_000, valid: true });
  expect(budgetOf("1000000")).toEqual({ tokens: 1_000_000_000_000, valid: true });
});

test("zero, a negative, a fraction of a token, text, an empty field or more than 10^12 is not sent", () => {
  for (const text of ["", " ", "0", "-1", "0.0000001", "abc", "1e", "1000001"]) {
    expect([text, budgetOf(text).valid]).toEqual([text, false]);
  }
});
