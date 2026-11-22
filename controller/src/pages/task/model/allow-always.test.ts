import { expect, mock, test } from "bun:test";
import * as agents from "../../../entities/agent/model/agents";
import * as allowlist from "../../../entities/agent/model/allowlist";

// The entity's public API also brings its React hooks and expo-sqlite, which Bun cannot load.
// Its whole plain API, as links.test mocks it: Bun keeps one mock per module for the whole run.
mock.module("../../../entities/agent", () => ({ ...agents, ...allowlist }));
const { canAllowAlways } = await import("./allow-always");

test("signs only when every edited entry still covers its own part", () => {
  expect(
    canAllowAlways([
      { entry: "git status", part: "git status" },
      { entry: "npm test", part: "npm test --watch" },
    ]),
  ).toBe(true);
  expect(
    canAllowAlways([
      { entry: "git status", part: "git status" },
      { entry: "npm run", part: "npm test" },
    ]),
  ).toBe(false);
  expect(canAllowAlways([{ entry: "  ", part: "npm test" }])).toBe(false);
  expect(canAllowAlways([])).toBe(false);
});
