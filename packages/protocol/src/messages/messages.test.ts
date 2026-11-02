import { expect, test } from "bun:test";
import { parseMessage } from ".";

const error = (body: unknown) => parseMessage({ type: "error", body });

test("an error keeps its code and parameters as sent, even a code this build has never seen", () => {
  const body = { code: "future.thing_failed", params: { minutes: 46, agent: "Deployer", retry: true } };
  expect(error(body)).toEqual({ kind: "message", message: { type: "error", body } });
});

test("an error with no code, a sentence for a code or a nested parameter is invalid, without throwing", () => {
  for (const body of [{}, null, { code: "Agent could not start" }, { code: "a.b", params: { nested: { x: 1 } } }]) {
    expect(error(body)).toEqual({ kind: "invalid" });
  }
});

test("a type this build does not know is reported, including names found on every object", () => {
  expect(parseMessage({ type: "task.message", body: {} })).toEqual({ kind: "unknown", type: "task.message" });
  expect(parseMessage({ type: "constructor", body: {} })).toEqual({ kind: "unknown", type: "constructor" });
});
