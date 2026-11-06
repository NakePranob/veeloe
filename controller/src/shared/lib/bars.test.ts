import { expect, test } from "bun:test";
import { barHeight, barShare } from "./bars";

test("a bar fills its share of the tallest one, and nothing when the tallest is zero or the value is not above it", () => {
  expect(barShare(50, 100)).toBe(0.5);
  expect(barShare(100, 100)).toBe(1);
  expect(barShare(0, 100)).toBe(0);
  expect(barShare(10, 0)).toBe(0);
  expect(barShare(-5, 100)).toBe(0);
});

test("a day with no data is a gap, a known day always shows at least a sliver, and the tallest fills the chart", () => {
  expect(barHeight({ value: 10, known: false }, 10, 50)).toBe(0);
  expect(barHeight({ value: 0, known: true }, 10, 50)).toBe(0);
  expect(barHeight({ value: 1, known: true }, 1_000, 50)).toBe(2);
  expect(barHeight({ value: 5, known: true }, 10, 50)).toBe(25);
  expect(barHeight({ value: 10, known: true }, 10, 50)).toBe(50);
});
