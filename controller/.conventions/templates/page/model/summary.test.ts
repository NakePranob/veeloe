import { expect, test } from "bun:test";
import { daysBetween, rowsInRange, totalOf } from "./summary";

const rows = [
  { agent_id: "a1", day: "2026-10-31", tokens: 10 },
  { agent_id: "a1", day: "2026-11-06", tokens: 20 },
  { agent_id: "a2", day: "2026-11-06", tokens: 30 },
];

test("every Budget day between the ends is a column, across a month and a year", () => {
  expect(daysBetween("2026-11-04", "2026-11-06")).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
  expect(daysBetween("2026-10-31", "2026-11-01")).toEqual(["2026-10-31", "2026-11-01"]);
  expect(daysBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  expect(daysBetween("2026-11-06", "2026-11-05")).toEqual([]);
});

test("a range counts only its own Agents and days, and the total is their sum", () => {
  const inRange = rowsInRange(rows, new Set(["a1", "a2"]), "2026-11-01", "2026-11-06");
  expect(inRange).toEqual([rows[1], rows[2]]);
  expect(totalOf(inRange)).toBe(50);
  expect(rowsInRange(rows, new Set(["a1"]), "2026-11-01", "2026-11-06")).toEqual([rows[1]]);
});
