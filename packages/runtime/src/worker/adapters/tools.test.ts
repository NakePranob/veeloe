import { expect, test } from "bun:test";
import type { ToolRunner } from "../core/ports";
import { combineTools } from "./tools";

const fake = (name: string, answer: string): ToolRunner => ({
  definitions: () => [{ name, description: name, input_schema: { type: "object", properties: {} } }],
  run: async (called) => `${called}:${answer}`,
});

test("one runner carries every tool and sends each name to its own runner", async () => {
  const tools = combineTools([fake("bash", "shell"), fake("read", "file")]);
  expect(tools.definitions().map((definition) => definition.name)).toEqual(["bash", "read"]);
  expect(await tools.run("bash", {})).toBe("bash:shell");
  expect(await tools.run("read", {})).toBe("read:file");
});

test("a name may belong to one tool only, and an unknown name is named", async () => {
  expect(() => combineTools([fake("read", "one"), fake("read", "two")])).toThrow(/duplicate tool: read/);
  await expect(combineTools([fake("read", "one")]).run("write", {})).rejects.toThrow(/no tool named write/);
});
