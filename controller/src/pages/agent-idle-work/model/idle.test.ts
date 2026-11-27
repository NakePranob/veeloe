import { expect, test } from "bun:test";
import type { ListedTrigger } from "@veeloe/protocol-ts";
import { draftOf, listOf, piecesOf } from "./idle";

const listed: ListedTrigger = {
  id: "idle",
  kind: "idle",
  text: "Idle Work",
  idle: {
    items: [
      { id: "a", text: "tests" },
      { id: "b", text: "deps", repeat: true },
      { id: "c", text: "docs" },
    ],
    order: "oldest-first",
    quietMinutes: 30,
    itemMinutes: 15,
  },
  member: "m",
  paused: false,
  suspended: false,
  allow: ["curl"],
  progress: [
    { id: "b", status: "pending", lastRunAt: 5 },
    { id: "c", status: "needsApproval", task: "t-c" },
  ],
};

test("the sheet opens the list as it stands, a done one-off piece gone, and the Agent's draft after it", () => {
  let n = 0;
  const draft = draftOf(listed, ["write the README"], () => `new-${++n}`);
  expect(draft.items).toEqual([
    { id: "b", text: "deps", repeat: true },
    { id: "c", text: "docs", repeat: false },
    { id: "new-1", text: "write the README", repeat: false },
  ]);
  expect(draft).toMatchObject({ order: "oldest-first", quietMinutes: 30, itemMinutes: 15 });
});

test("a save signs the pieces with words, keeps the Machine's scope, and refuses an empty list", () => {
  const draft = {
    items: [
      { id: "a", text: " tests ", repeat: false },
      { id: "b", text: "  ", repeat: true },
    ],
    order: "ordered" as const,
    quietMinutes: 15,
    itemMinutes: 15,
  };
  expect(listOf(draft, "idle", ["curl"])).toEqual({ id: "idle", kind: "idle", text: "Idle Work", idle: { items: [{ id: "a", text: "tests" }], order: "ordered", quietMinutes: 15, itemMinutes: 15 }, allow: ["curl"] });
  expect(listOf({ ...draft, items: [] }, "idle")).toBe("empty");
});

test("the pieces shown are the ones still on the list, with their words", () => {
  expect(piecesOf(listed).map((p) => [p.id, p.text, p.status])).toEqual([
    ["b", "deps", "pending"],
    ["c", "docs", "needsApproval"],
  ]);
});
