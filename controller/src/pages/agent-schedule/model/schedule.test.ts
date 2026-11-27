import { expect, test } from "bun:test";
import { draftOf, EMPTY_DRAFT, lastRoundOf, scheduleOf, triggerOf } from "./schedule";

test("each kind of round becomes the structure the Protocol signs", () => {
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "every", minutes: "30" })).toEqual({ every: { minutes: 30 } });
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "daily", at: "09:00" })).toEqual({ daily: { at: "09:00" } });
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "weekly", day: 1, at: "08:30" })).toEqual({ weekly: { day: 1, at: "08:30" } });
});

test("a round more often than 15 minutes, a time that is not one, or no words is refused before anything is sent", () => {
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "every", minutes: "5" })).toBe("tooOften");
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "every", minutes: "abc" })).toBe("tooOften");
  expect(scheduleOf({ ...EMPTY_DRAFT, mode: "daily", at: "25:00" })).toBe("badTime");
  expect(triggerOf({ ...EMPTY_DRAFT, text: "   " }, "tr_1")).toBe("empty");
});

test("a Trigger to send keeps its id, and an existing one opens as the draft it was", () => {
  const made = triggerOf({ ...EMPTY_DRAFT, text: " check the CI ", mode: "daily", at: "07:15" }, "tr_1");
  expect(made).toEqual({ id: "tr_1", kind: "schedule", text: "check the CI", schedule: { daily: { at: "07:15" } } });
  expect(draftOf({ id: "tr_1", kind: "schedule", text: "x", schedule: { weekly: { day: 5, at: "18:00" } } })).toEqual({ ...EMPTY_DRAFT, text: "x", mode: "weekly", day: 5, at: "18:00" });
  expect(draftOf({ id: "tr_1", kind: "schedule", text: "x", schedule: { every: { minutes: 60 } } })).toEqual({ ...EMPTY_DRAFT, text: "x", mode: "every", minutes: "60" });
});

test("an edit keeps the Schedule's scope as the Machine holds it, so saving new words does not take back what it may do (ADR 0079)", () => {
  const draft = draftOf({ id: "tr_1", kind: "schedule", text: "x", schedule: { daily: { at: "09:00" } } });
  expect(triggerOf({ ...draft, text: "y" }, "tr_1", ["curl"])).toEqual({ id: "tr_1", kind: "schedule", text: "y", schedule: { daily: { at: "09:00" } }, allow: ["curl"] });
});

test("the last round is the skip or the Task, whichever came later", () => {
  const round = { task: "t1", at: 100, quiet: false, status: "done" as const };
  expect(lastRoundOf({ lastSkip: { at: 200, why: "busy" } }, round)).toEqual({ at: 200, outcome: "busy" });
  expect(lastRoundOf({ lastSkip: { at: 50, why: "budget" } }, round)).toEqual({ at: 100, outcome: "done", task: "t1" });
  expect(lastRoundOf({}, { ...round, quiet: true })).toEqual({ at: 100, outcome: "quiet", task: "t1" });
  expect(lastRoundOf({}, undefined)).toBeNull();
});
