import { expect, test } from "bun:test";
import { clockSequence } from "./sequence";

test("the number is the clock's while the clock moves ahead", () => {
  let time = 1000;
  const next = clockSequence(() => time);
  expect(next()).toBe(1000);
  time = 2000;
  expect(next()).toBe(2000);
});

test("it still goes up when the clock steps back or does not tick", () => {
  let time = 1000;
  const next = clockSequence(() => time);
  expect([next(), next(), next()]).toEqual([1000, 1001, 1002]);
  time = 500;
  expect(next()).toBe(1003);
});

test("a new start of the app is ahead of what the last one sent", () => {
  let time = 1000;
  const first = clockSequence(() => time);
  first();
  time = 1001;
  expect(clockSequence(() => time)()).toBeGreaterThan(1000);
});
