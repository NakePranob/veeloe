import { expect, test } from "bun:test";
import { clock, dayDistance } from "./time";

test("days count calendar days, not 24-hour spans", () => {
  const now = new Date(2026, 10, 21, 0, 30).getTime();
  expect(dayDistance(new Date(2026, 10, 21, 0, 5).getTime(), now)).toBe(0);
  expect(dayDistance(new Date(2026, 10, 20, 23, 59).getTime(), now)).toBe(1);
  expect(dayDistance(new Date(2026, 10, 19, 1, 0).getTime(), now)).toBe(2);
});

test("a stopwatch shows minutes and two-digit seconds", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(65_400)).toBe("1:05");
  expect(clock(600_000)).toBe("10:00");
});
