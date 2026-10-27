import { expect, test } from "bun:test";
import { getAgents, updateCharacter } from "./agents";
import { COLORS, DECALS, lookOf, pick, sameLook, SHELLS, SIDES, shuffleLook, TOPS } from "./look";

const deployer = { color: "#F4B183", shell: "chamfer", top: "beacon", sides: "ears", decal: "grille" } as const;

test("a known look comes through as it is", () => {
  expect(lookOf(deployer)).toEqual(deployer);
});

test("a shell from a newer version falls back to the box and keeps the rest", () => {
  expect(lookOf({ ...deployer, shell: "orb" })).toEqual({ ...deployer, shell: "box" });
});

test("an unknown part falls back to none and keeps the rest", () => {
  expect(lookOf({ ...deployer, top: "propeller" })).toEqual({ ...deployer, top: "none" });
});

test("a colour that is not a hex colour falls back to the first one", () => {
  expect(lookOf({ ...deployer, color: "red" }).color).toBe("#F4B183");
  expect(lookOf({}).shell).toBe("box");
});

const deployerNow = () => getAgents().find((agent) => agent.id === "deployer")!.character;

test("Done applies the whole draft at once", () => {
  const start = deployerNow();
  const draft = pick(pick(start, "color", "#92D5C8"), "top", "antenna");
  updateCharacter("deployer", draft);
  expect(deployerNow()).toEqual({ ...start, color: "#92D5C8", top: "antenna" });
  updateCharacter("deployer", start);
});

test("Cancel, or swiping the sheet away, leaves the Agent as it was", () => {
  const start = deployerNow();
  const draft = pick(start, "shell", "dome");
  expect(draft.shell).toBe("dome");
  expect(start.shell).toBe("chamfer");
  expect(deployerNow()).toBe(start);
});

test("a shuffle skips a look another Agent already has", () => {
  const taken = { color: COLORS[0], shell: SHELLS[0], top: TOPS[0], sides: SIDES[0], decal: DECALS[0] };
  // The first five draws give the taken look; the next five the last option of each slot.
  const draws = [0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99];
  const look = shuffleLook([taken], () => draws.shift()!);
  expect(sameLook(look, taken)).toBe(false);
  expect(look).toEqual({ color: COLORS.at(-1)!, shell: SHELLS.at(-1)!, top: TOPS.at(-1)!, sides: SIDES.at(-1)!, decal: DECALS.at(-1)! });
});
