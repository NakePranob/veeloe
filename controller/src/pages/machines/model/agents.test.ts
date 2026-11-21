import { expect, test } from "bun:test";
import { countsOf, ordered } from "./agents";

test("Agents that need the Owner come first, then working ones, each keeping its order", () => {
  const rows = [
    { id: "a", status: "done" as const },
    { id: "b", status: "working" as const },
    { id: "c", status: "waiting" as const },
    { id: "d", status: "failed" as const },
    { id: "e", status: "new" as const },
  ];
  expect(ordered(rows).map((r) => r.id)).toEqual(["c", "d", "b", "a", "e"]);
  expect(countsOf(rows)).toEqual({ needsYou: 2, working: 1, idle: 2 });
});
