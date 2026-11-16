// `bun run check:structure`: every half's structure rules (ADR 0070, 0071). Each step
// runs even when one before it failed, so every failure prints its rule id.
import { $ } from "bun";

const steps: [string, string, string[]][] = [
  ["Controller", "controller", ["bun", "scripts/check-structure.ts"]],
  ["Hub", "hub", ["go", "test", "-count=1", "./internal/archtest/"]],
  ["Runtime and protocol", "packages/runtime", ["cargo", "test", "-q", "-p", "veeloe-runtime-core", "--test", "structure"]],
  // rule `rustfmt` (ADR 0071): a file listed here needs `cargo fmt`.
  ["rustfmt: Runtime", "packages/runtime", ["cargo", "fmt", "--all", "--", "--check", "-l"]],
  ["rustfmt: protocol", "packages/protocol", ["cargo", "fmt", "--", "--check", "-l"]],
];

const failed: string[] = [];
for (const [name, cwd, argv] of steps) {
  console.log(`== structure: ${name}`);
  const result = await $`${argv}`.cwd(cwd).nothrow();
  if (result.exitCode !== 0) failed.push(name);
}
if (failed.length > 0) {
  console.error(`structure failed: ${failed.join(", ")}`);
  process.exit(1);
}
