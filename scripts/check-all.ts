// `bun run check`: every check CI runs before tests. Each step runs even when
// one before it failed, so a compile error never hides a rule id behind it.
import { $ } from "bun";

const steps = ["typecheck", "check:structure", "check:controller", "check:runtime", "check:protocol"];
const failed: string[] = [];
for (const step of steps) {
  console.log(`\n== ${step}`);
  const result = await $`bun run ${step}`.nothrow();
  if (result.exitCode !== 0) failed.push(step);
}
if (failed.length > 0) {
  console.error(`\ncheck failed: ${failed.join(", ")}`);
  process.exit(1);
}
