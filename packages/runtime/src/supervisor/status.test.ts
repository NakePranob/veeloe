import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supervisorDir } from "./config";
import { FAKE_KEY } from "./providers/fake-provider";
import { saveProviders } from "./providers/store";
import { runStatus, supervisorPid } from "./status";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function home() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-status-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("status shows each Provider and never its key, and says what to do next", () => {
  const dir = home();
  saveProviders(dir, [{ name: "main", url: "https://api.anthropic.com", key: FAKE_KEY, auth: "x-api-key", preset: "anthropic" }]);
  const lines: string[] = [];
  runStatus({ home: dir, env: {}, log: (l) => lines.push(l) });
  const out = lines.join("\n");
  expect(out).toContain("main  anthropic  https://api.anthropic.com");
  expect(out).not.toContain(FAKE_KEY.slice(0, 6));
  expect(out).toContain("Next: run veeloe to pair");
});

test("a pid file left by a supervisor that is gone reads as not running", async () => {
  const dir = home();
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  writeFileSync(join(supervisorDir(dir), "supervisor.pid"), `${gone.pid}\n`);
  expect(supervisorPid(dir)).toBeUndefined();
  writeFileSync(join(dir, "runtime/supervisor.pid"), `${process.pid}\n`);
  expect(supervisorPid(dir)).toBe(process.pid);
});
