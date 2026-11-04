import type { ToolRunner } from "../core/ports";

// ponytail: no tools until there is a sandbox to run them in (`sandboxed-commands`, `workdir-file-tools`).
export const noTools: ToolRunner = {
  definitions: () => [],
  run: async (name) => {
    throw new Error(`there is no tool named ${name}`);
  },
};
