import { expect, test } from "bun:test";
import { meterLevel } from "./meter-level";

test("a Meter is ink up to 80%, orange past it, red once used up", () => {
  expect(meterLevel(0)).toBe("normal");
  expect(meterLevel(0.8)).toBe("normal");
  expect(meterLevel(0.81)).toBe("near");
  expect(meterLevel(0.99)).toBe("near");
  expect(meterLevel(1)).toBe("full");
  expect(meterLevel(1.4)).toBe("full");
});
