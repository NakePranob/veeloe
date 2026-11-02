import { expect, test } from "bun:test";
import { addChanges, checkWatchPath, elapse, isDue, pickItem } from "./rules";

test("a burst merges, and a file that never goes quiet still starts at 30 minutes", () => {
  let pending = addChanges(undefined, 8);
  expect(isDue(pending, 5)).toBe(false);
  pending = elapse(pending, 5, false);
  expect(isDue(pending, 5)).toBe(true);
  pending = elapse(addChanges(undefined, 1), 29, true);
  expect(isDue(pending, 5)).toBe(false);
  expect(isDue(elapse(pending, 1, true), 5)).toBe(true);
});

test("Use only reaches Workdir and Library, never a secret", () => {
  expect(checkWatchPath("workdir/drafts/", "use", []).ok).toBe(true);
  expect(checkWatchPath("library/faq/index.md", "use", ["faq"]).ok).toBe(true);
  expect(checkWatchPath("library/other", "use", ["faq"]).ok).toBe(false);
  expect(checkWatchPath("/var/log/app.log", "use", []).ok).toBe(false);
  expect(checkWatchPath("/var/log/app.log", "manage", []).ok).toBe(true);
  expect(checkWatchPath("/home/me/.env", "manage", []).ok).toBe(false);
  expect(checkWatchPath("workdir/../../etc", "manage", []).ok).toBe(false);
});

test("the signed rule picks, a fixed order does not reorder", () => {
  const items = [
    { id: "a", text: "a", since: 3, minutes: 9, status: "todo" as const },
    { id: "b", text: "b", since: 1, minutes: 20, status: "todo" as const },
    { id: "c", text: "c", since: 2, minutes: 2, status: "done" as const },
  ];
  expect(pickItem({ order: "fixed", rule: "oldest", items })?.id).toBe("a");
  expect(pickItem({ order: "rule", rule: "oldest", items })?.id).toBe("b");
  expect(pickItem({ order: "rule", rule: "smallest", items })?.id).toBe("a");
});
