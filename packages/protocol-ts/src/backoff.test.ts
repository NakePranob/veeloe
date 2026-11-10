import { expect, test } from "bun:test";
import { createBackoff } from "./backoff";

test("the ceiling doubles from 1 s up to the 30 s cap and stays there", () => {
  const b = createBackoff({ random: () => 1 });
  expect(Array.from({ length: 8 }, () => b.next())).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("full jitter picks anywhere below the ceiling", () => {
  const b = createBackoff({ random: () => 0.25 });
  expect([b.next(), b.next(), b.next()]).toEqual([250, 500, 1000]);
});

test("reset starts over after a successful connection", () => {
  const b = createBackoff({ random: () => 1 });
  b.next();
  b.next();
  b.reset();
  expect(b.next()).toBe(1000);
});
