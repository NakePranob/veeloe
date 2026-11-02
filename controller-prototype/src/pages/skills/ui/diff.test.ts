import { expect, test } from "bun:test";
import { diffFiles } from "./diff";

const f = (path: string, content: string) => ({ path, content, size: content.length });

test("a new version shows added, removed and changed files", () => {
  const diff = diffFiles([f("SKILL.md", "a\nb"), f("old.sh", "x")], [f("SKILL.md", "a\nc"), f("new.sh", "y")]);
  expect(diff.map((item) => item.state)).toEqual(["changed", "added", "removed"]);
  expect(diff[0].added).toEqual(["c"]);
  expect(diff[0].removed).toEqual(["b"]);
});
