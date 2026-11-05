import { expect, test } from "bun:test";
import { pickKey } from "./terminal";

test("arrows move and wrap, Enter or a number picks, Esc and Ctrl-C cancel", () => {
  expect(pickKey("\u001b[B", 0, 3)).toEqual({ at: 1 });
  expect(pickKey("\u001b[A", 0, 3)).toEqual({ at: 2 });
  expect(pickKey("\u001b[B", 2, 3)).toEqual({ at: 0 });
  expect(pickKey("\r", 1, 3)).toEqual({ picked: 1 });
  expect(pickKey("3", 0, 3)).toEqual({ picked: 2 });
  expect(pickKey("9", 0, 3)).toEqual({ at: 0 });
  expect(pickKey("\u001b", 1, 3)).toBe("cancel");
  expect(pickKey("\u0003", 1, 3)).toBe("cancel");
});
