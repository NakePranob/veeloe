import { expect, test } from "bun:test";
import { daysLeft } from "./trash";

const DAY = 24 * 60 * 60 * 1_000;
const row = (deleted_at: number, restore_until: number) => ({ deleted_at, restore_until });

test("the last day reads as one day left, and a purged or expired row is never negative", () => {
  const now = 1_800_000_000_000;
  expect(daysLeft(row(now, now + 30 * DAY), now)).toBe(30);
  expect(daysLeft(row(now - 29 * DAY, now + DAY), now)).toBe(1);
  expect(daysLeft(row(now - 30 * DAY, now), now)).toBe(0);
  expect(daysLeft(row(now - 30 * DAY - 1, now - 1), now)).toBe(0);
});

test("a reading taken before the Machine's own deletedAt never rounds up past the window", () => {
  const deleted = 1_800_000_000_000;
  expect(daysLeft(row(deleted, deleted + 30 * DAY), deleted - 5_000)).toBe(30);
});
