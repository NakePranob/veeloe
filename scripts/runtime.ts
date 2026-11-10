/**
 * Builds the one Runtime the e2e files and the iOS flow harness drive: the Rust
 * supervisor. The TypeScript Runtime it replaced is gone (ADR-era rollback path
 * retired), so there is no longer a switch to ask about.
 */
import { dirname, join } from "node:path";

const repo = dirname(import.meta.dir);

/** Builds the debug supervisor and answers the binary to drive. */
export function buildRuntime(): string {
  // The supervisor starts itself in worker mode, so this one crate is the whole
  // Runtime.
  const built = Bun.spawnSync(["cargo", "build", "-p", "veeloe-runtime-supervisor"], {
    cwd: join(repo, "packages/runtime"),
    stderr: "inherit",
  });
  if (!built.success) throw new Error("could not build the Rust Runtime");
  return join(repo, "packages/runtime/target/debug/veeloe");
}
