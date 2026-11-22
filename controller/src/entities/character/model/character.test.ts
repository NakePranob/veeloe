import { expect, test } from "bun:test";
import { COLORS, DECALS, DEFAULT_COLOR, lookOf, lookOfJson, sameLook, SHELLS, shuffleLook, SIDES, tint, TOPS } from "./look";
import { hopsOn, type Mood, moodOf } from "./mood";

test("a shuffle draws only from the lists, and every option of every slot comes up", () => {
  const seen = { color: new Set<string>(), shell: new Set<string>(), top: new Set<string>(), sides: new Set<string>(), decal: new Set<string>() };
  for (let i = 0; i < 3000; i++) {
    const look = shuffleLook([]);
    for (const slot of Object.keys(seen) as (keyof typeof seen)[]) seen[slot].add(look[slot]);
  }
  expect([...seen.color].sort()).toEqual([...COLORS].sort());
  expect([...seen.shell].sort()).toEqual([...SHELLS].sort());
  expect([...seen.top].sort()).toEqual([...TOPS].sort());
  expect([...seen.sides].sort()).toEqual([...SIDES].sort());
  expect([...seen.decal].sort()).toEqual([...DECALS].sort());
});

test("a shuffle skips a look another Agent has", () => {
  // The first draw always gives the first of everything, the second something else.
  let n = 0;
  const random = () => (n++ < 5 ? 0 : 0.99);
  // The look the first draw gives: the first of every list, which is not the default look any more.
  const taken = lookOf({ color: COLORS[0] });
  const look = shuffleLook([taken], random);
  expect(sameLook(look, taken)).toBe(false);
  expect(look).toEqual({ color: COLORS.at(-1)!, shell: SHELLS.at(-1)!, top: TOPS.at(-1)!, sides: SIDES.at(-1)!, decal: DECALS.at(-1)! });
});

test("no Character is the one default look, and a slot this build does not know falls back alone", () => {
  expect(lookOf(null)).toEqual({ color: DEFAULT_COLOR, shell: "box", top: "none", sides: "none", decal: "none" });
  expect(lookOfJson(null)).toEqual(lookOf(null));
  expect(lookOfJson("not json")).toEqual(lookOf(null));
  expect(lookOfJson(JSON.stringify({ color: "#9DC3E6", shell: "orb", top: "antenna", sides: "ears", decal: "grille" }))).toEqual({ color: "#9DC3E6", shell: "box", top: "antenna", sides: "ears", decal: "grille" });
});

const e = (kind: string, body: unknown = {}) => ({ kind, body: JSON.stringify(body) });

test("the six Moods come from the latest event and whether the Machine is online", () => {
  // An Approval the Agent is waiting on raises the hand until someone answers.
  expect(moodOf([e("turn.started"), e("approval.requested", { request: "ap_1" })], true)).toBe("waiting");
  expect(moodOf([e("approval.requested", { request: "ap_1" }), e("approval.answered", { decision: "approve" })], true)).toBe("thinking");
  expect(moodOf([], true)).toBe("idle");
  expect(moodOf([e("member.message"), e("turn.started")], true)).toBe("thinking");
  expect(moodOf([e("turn.started"), e("llm.message", { content: [{ type: "text", text: "hi" }] })], true)).toBe("thinking");
  expect(moodOf([e("turn.started"), e("llm.message", { content: [{ type: "tool_use", id: "t", name: "bash", input: {} }] })], true)).toBe("working");
  expect(moodOf([e("turn.ended", { reason: "done" })], true)).toBe("done");
  expect(moodOf([e("turn.started")], false)).toBe("offline");
});

test("a failed Turn is failed, a stopped or interrupted one idle, a tool result goes back to thinking, and an unknown Machine is not offline", () => {
  expect(moodOf([e("turn.started"), e("turn.ended", { reason: "error", code: "provider.unreachable" })], true)).toBe("failed");
  expect(moodOf([e("turn.started"), e("turn.ended", { reason: "stopped" })], true)).toBe("idle");
  expect(moodOf([e("turn.started"), e("turn.ended", { reason: "interrupted" })], true)).toBe("idle");
  expect(moodOf([e("turn.ended", { reason: "error" })], false)).toBe("offline");
  expect(moodOf([e("turn.started"), e("turn.stalled", { since: 1 })], true)).toBe("stuck");
  expect(moodOf([e("turn.stalled", { since: 1 }), e("llm.message", { content: [] })], true)).toBe("thinking");
  expect(moodOf([e("turn.stalled", { since: 1 })], false)).toBe("offline");
  const tool = [e("turn.started"), e("llm.message", { content: [{ type: "tool_use", id: "t", name: "bash", input: {} }] })];
  expect(moodOf(tool, true)).toBe("working");
  expect(moodOf([...tool, e("tool.result", { content: [{ type: "tool_result", tool_use_id: "t" }] })], true)).toBe("thinking");
  expect(moodOf([e("turn.ended", { reason: "done" })], null)).toBe("done");
});

test("an event of a kind this build does not know is skipped", () => {
  expect(moodOf([e("turn.ended", { reason: "done" }), e("future.thing")], true)).toBe("done");
  expect(moodOf([e("future.thing")], true)).toBe("idle");
});

test("a new palette never changes an existing Agent's colour or the default look", () => {
  expect(lookOf(null).color).toBe("#F4B183");
  expect(lookOf({ color: "#9DC3E6" }).color).toBe("#9DC3E6");
});

test("round is a shell, and a shell this build does not know is still box", () => {
  expect(lookOf({ shell: "round" }).shell).toBe("round");
  expect(lookOf({ shell: "hexagon" }).shell).toBe("box");
});

test("tint lifts a colour toward white", () => {
  expect(tint("#C4B1FF", 0)).toBe("#c4b1ff");
  expect(tint("#C4B1FF", 1)).toBe("#ffffff");
  expect(tint("#000000", 0.5)).toBe("#808080");
});

test("a Turn starting from rest hops and finishing hops, but a failed one never does", () => {
  const all: Mood[] = ["idle", "thinking", "working", "waiting", "done", "failed", "stuck", "offline"];
  for (const was of all) {
    expect(hopsOn(was, "failed")).toBe(false);
    expect(hopsOn(was, "done")).toBe(true);
  }
  expect(hopsOn("idle", "thinking")).toBe(true);
  expect(hopsOn("failed", "working")).toBe(true);
  expect(hopsOn("thinking", "working")).toBe(false);
});
