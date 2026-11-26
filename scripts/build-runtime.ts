/**
 * Builds the `veeloe` binary the release ships: the Rust Runtime. Its crash
 * behaviour and its workers are the whole Runtime, so one artifact is enough.
 */
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const repo = dirname(import.meta.dir);
const outfile = join(repo, "dist", "veeloe");

mkdirSync(dirname(outfile), { recursive: true });

// The supervisor starts itself in worker mode, so this one crate is the whole
// Runtime.
const built = Bun.spawnSync(["cargo", "build", "--release", "-p", "veeloe-runtime-supervisor"], {
  cwd: join(repo, "packages/runtime"),
  stdout: "inherit",
  stderr: "inherit",
});
if (!built.success) throw new Error("could not build the Rust Runtime");
copyFileSync(join(repo, "packages/runtime/target/release/veeloe"), outfile);
chmodSync(outfile, 0o755);

console.log(`rust: ${outfile}`);
