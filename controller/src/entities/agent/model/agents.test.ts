import { afterEach, expect, test } from "bun:test";
import { getAgents, subscribeAgents, updateCharacter } from "./agents";

const before = getAgents();
afterEach(() => before.forEach((agent) => updateCharacter(agent.id, agent.character)));

test("a new look reaches every listener and changes no other Agent", () => {
  const seen: string[] = [];
  const stop = subscribeAgents(() => seen.push(getAgents().find((agent) => agent.id === "deployer")!.character.shell));
  updateCharacter("deployer", { color: "#92D5C8", shell: "dome", top: "fin", sides: "none", decal: "brow" });
  stop();
  expect(seen).toEqual(["dome"]);
  expect(getAgents().find((agent) => agent.id === "deployer")!.character).toEqual({ color: "#92D5C8", shell: "dome", top: "fin", sides: "none", decal: "brow" });
  for (const agent of getAgents().filter((agent) => agent.id !== "deployer")) expect(agent).toBe(before.find((old) => old.id === agent.id)!);
});

test("the Demo Workspace keeps a new look on the device", () => {
  const calls: string[] = [];
  const { fetch, WebSocket } = globalThis;
  globalThis.fetch = (() => calls.push("fetch")) as unknown as typeof fetch;
  globalThis.WebSocket = function () {
    calls.push("WebSocket");
  } as unknown as typeof WebSocket;
  try {
    updateCharacter("tester", { color: "#F2A7B8", shell: "capsule", top: "none", sides: "pods", decal: "none" });
  } finally {
    Object.assign(globalThis, { fetch, WebSocket });
  }
  expect(calls).toEqual([]);
});
