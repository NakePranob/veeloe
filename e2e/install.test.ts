import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// packaging/install.sh against a release folder read through file://: it installs only a binary
// whose SHA-256 matches the release's SHA256SUMS (ADR 0009; the signed manifest waits for v0.3).
const script = join(import.meta.dir, "../packaging/install.sh");
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? (os === "darwin" ? "arm64" : "aarch64") : "x86_64";
const asset = `veeloe-${os}-${arch}`;
let dir = "";

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function release(binary: string, sums: string | null) {
  dir = mkdtempSync(join(tmpdir(), "veeloe-install-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, asset), binary);
  const sha = createHash("sha256").update(binary).digest("hex");
  writeFileSync(join(dir, "SHA256SUMS"), sums ?? `${sha}  ${asset}\n`);
  return Bun.spawnSync(["sh", script], { env: { ...process.env, VEELOE_RELEASE_URL: `file://${dir}`, VEELOE_BIN_DIR: join(dir, "bin") } });
}

test("a binary that matches SHA256SUMS is installed", () => {
  const run = release("#!/bin/sh\necho veeloe\n", null);
  expect(run.exitCode).toBe(0);
  expect(readFileSync(join(dir, "bin/veeloe"), "utf8")).toBe("#!/bin/sh\necho veeloe\n");
});

test("a binary that does not match is refused and nothing is installed", () => {
  const run = release("#!/bin/sh\necho evil\n", `${"0".repeat(64)}  ${asset}\n`);
  expect(run.exitCode).toBe(1);
  expect(run.stderr.toString()).toContain("checksum mismatch");
  expect(existsSync(join(dir, "bin/veeloe"))).toBe(false);
});

test("a release whose SHA256SUMS leaves the binary out is refused", () => {
  const run = release("#!/bin/sh\necho veeloe\n", `${"0".repeat(64)}  something-else\n`);
  expect(run.exitCode).toBe(1);
  expect(existsSync(join(dir, "bin/veeloe"))).toBe(false);
});
