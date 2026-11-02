import { expect, test } from "bun:test";
import { doerOwner, findCycle, hasRight, pathClosed, projectAgents, type Project, type Team } from "./projects";

const base = { template: "code" as const, machineId: "m", rights: {}, forbiddenPaths: [], forbiddenTopics: [], closedToAsk: [], repos: [], worktreeDefault: true, skills: [], wiki: [] };
const project = (name: string): Project => ({ ...base, id: name, name, doers: [], wikiWriter: "" });
const team = (name: string, entry: string, employees: string[]): Team => ({ id: name, name, machineId: "m", entry, employees, roles: {}, cap: 5 });

test("delegation loops across Teams on one Machine are found, and named", () => {
  const a = team("A", "x", ["x", "y"]);
  expect(findCycle([a], "m")).toBeNull();
  const loop = findCycle([a, team("B", "y", ["y", "x"])], "m");
  expect(loop?.teams.sort()).toEqual(["A", "B"]);
  // Another Machine's Teams do not count.
  expect(findCycle([a, { ...team("B", "y", ["y", "x"]), machineId: "other" }], "m")).toBeNull();
});

test("a Project's Agents are its single Agents and every employee of its Teams, once each", () => {
  const crew = team("A", "x", ["x", "y"]);
  const p = { ...project("P"), doers: [{ kind: "team", id: "A" }, { kind: "agent", id: "y" }, { kind: "agent", id: "z" }] } as Project;
  expect(projectAgents(p, [crew]).sort()).toEqual(["x", "y", "z"]);
  expect(doerOwner({ kind: "team", id: "A" }, [crew])).toBe("x");
  expect(doerOwner({ kind: "agent", id: "z" }, [crew])).toBe("z");
});

test("a Project right includes the lower ones, and an Owner has Manage", () => {
  const p = { ...project("A"), rights: { nok: "ask" } } as Project;
  expect(hasRight(p, { id: "nok", owner: false }, "view")).toBe(true);
  expect(hasRight(p, { id: "nok", owner: false }, "use")).toBe(false);
  expect(hasRight(p, { id: "kai", owner: true }, "manage")).toBe(true);
  expect(hasRight(p, { id: "x", owner: false }, "view")).toBe(false);
});

test("secrets and forbidden paths are closed to Ask, others open", () => {
  const p = { ...project("A"), forbiddenPaths: ["secrets/"] } as Project;
  expect(pathClosed(p, "./.env.local")).not.toBeNull();
  expect(pathClosed(p, "secrets/key.txt")).not.toBeNull();
  expect(pathClosed(p, "src/app.ts")).toBeNull();
  expect(pathClosed(undefined, "deploy/id_rsa")).not.toBeNull();
});
