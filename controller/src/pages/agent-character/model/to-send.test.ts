import { expect, test } from "bun:test";
import { characterToSend } from "./to-send";

const draft = { color: "#9DC3E6", shell: "box", top: "antenna", sides: "ears", decal: "none" } as const;

test("changing only the colour sends back a shell this build does not know, and any field it does not know", () => {
  const stored = JSON.stringify({ color: "#F4B183", shell: "orb", top: "antenna", sides: "ears", decal: "none", glow: true });
  expect(characterToSend(stored, draft, new Set(["color"]))).toEqual({ color: "#9DC3E6", shell: "orb", top: "antenna", sides: "ears", decal: "none", glow: true } as never);
});

test("a slot the Owner picked replaces the unknown part, and an Agent with no Character gets the whole draft", () => {
  const stored = JSON.stringify({ color: "#F4B183", shell: "orb", top: "none", sides: "none", decal: "none" });
  expect(characterToSend(stored, draft, new Set(["shell"]))).toMatchObject({ color: "#F4B183", shell: "box" });
  expect(characterToSend(null, draft, new Set())).toEqual(draft);
  expect(characterToSend("not json", draft, new Set())).toEqual(draft);
});
