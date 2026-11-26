import { expect, test } from "bun:test";
import { SAVE_ANSWER_MS, settle } from "./settle";

const base = { landed: false, error: null, online: true, age: 0 };

test("a save waits for the Machine, and lands once it lists what went", () => {
  expect(settle(base)).toBe("waiting");
  expect(settle({ ...base, age: SAVE_ANSWER_MS - 1 })).toBe("waiting");
  expect(settle({ ...base, landed: true, error: "x", online: false, age: SAVE_ANSWER_MS })).toBe("landed");
});

test("the Machine's error fails a save, and going away or never answering lets it go", () => {
  expect(settle({ ...base, error: "agent.provider_unknown" })).toBe("failed");
  expect(settle({ ...base, online: false })).toBe("expired");
  expect(settle({ ...base, online: null })).toBe("waiting");
  expect(settle({ ...base, age: SAVE_ANSWER_MS })).toBe("expired");
});
