import { expect, test } from "bun:test";
import type { ListedTrigger } from "@veeloe/protocol-ts";
import { listOf, piecesOf, progressOf, settingsOf, withPiece } from "./idle";

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

test("the list opens as it stands, a done one-off piece gone, with its settings", () => {
  expect(piecesOf(listed)).toEqual([
    { id: "b", text: "deps", repeat: true },
    { id: "c", text: "docs", repeat: false },
  ]);
  expect(settingsOf(listed)).toEqual({ order: "oldest-first", quietMinutes: 30, itemMinutes: 15 });
  expect(settingsOf(undefined)).toEqual({ order: "ordered", quietMinutes: 15, itemMinutes: 15 });
});

test("a piece is changed in place, moved, or added last", () => {
  const pieces = piecesOf(listed);
  const docs = { id: "c", text: "docs!", repeat: false };
  expect(withPiece(pieces, docs, 1).map((p) => p.text)).toEqual(["deps", "docs!"]);
  expect(withPiece(pieces, docs, 0).map((p) => p.id)).toEqual(["c", "b"]);
  expect(withPiece(pieces, { id: "n", text: "new", repeat: false }).map((p) => p.id)).toEqual(["b", "c", "n"]);
});

test("a save signs the pieces with words, keeps the Machine's scope, and refuses an empty list", () => {
  const pieces = [
    { id: "a", text: " tests ", repeat: false },
    { id: "b", text: "  ", repeat: true },
  ];
  const settings = { order: "ordered" as const, quietMinutes: 15, itemMinutes: 15 };
  expect(listOf(pieces, settings, "idle", ["curl"])).toEqual({ id: "idle", kind: "idle", text: "Idle Work", idle: { items: [{ id: "a", text: "tests" }], ...settings }, allow: ["curl"] });
  expect(listOf([], settings, "idle")).toBe("empty");
});

test("the rows shown are the pieces still on the list, with their words", () => {
  expect(progressOf(listed).map((p) => [p.id, p.text, p.status])).toEqual([
    ["b", "deps", "pending"],
    ["c", "docs", "needsApproval"],
  ]);
});
