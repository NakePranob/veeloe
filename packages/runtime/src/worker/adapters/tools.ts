import type { ToolDefinition, ToolRunner } from "../core/ports";

/** One runner for the LLM: a name belongs to exactly one tool, so two sets can never shadow each other. */
export function combineTools(runners: ToolRunner[]): ToolRunner {
  const byName = new Map<string, ToolRunner>();
  const definitions: ToolDefinition[] = [];
  for (const runner of runners) {
    for (const definition of runner.definitions()) {
      if (byName.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`);
      byName.set(definition.name, runner);
      definitions.push(definition);
    }
  }
  return {
    definitions: () => definitions,
    async run(name, input) {
      const runner = byName.get(name);
      if (!runner) throw new Error(`there is no tool named ${name}`);
      return runner.run(name, input);
    },
  };
}
