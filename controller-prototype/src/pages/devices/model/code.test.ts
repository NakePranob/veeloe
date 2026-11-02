import { expect, test } from "bun:test";
import { newKey, shortCode } from "./code";

test("a key always gives the same code, and a swapped key gives another", () => {
  const key = newKey();
  expect(shortCode(key)).toBe(shortCode(key));
  expect(shortCode("a1b2c3d4e5f60718")).not.toBe(shortCode("ffffffffffffffff"));
});
