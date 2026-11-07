import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  // Alive and named like the supervisor: this is the one it is.
  const alive = Bun.spawn(["/bin/bash", "-c", "exec -a veeloe sleep 30"]);
  cleanup.push(() => alive.kill());
  writeFileSync(join(dir, "runtime/supervisor.pid"), `${alive.pid}\n`);
  expect(supervisorPid(dir)).toBe(alive.pid);
});

test("a pid the OS has given to another program is not taken for the supervisor", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-status-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });

  // A process that is alive, but is not a supervisor.
  const other = Bun.spawn(["/bin/sleep", "30"]);
  cleanup.push(() => other.kill());
  writeFileSync(join(home, "runtime", "supervisor.pid"), `${other.pid}\n`);
  expect(supervisorPid(home)).toBeUndefined();

  // One whose argv says veeloe is believed, as the compiled supervisor's would.
  const named = Bun.spawn(["/bin/bash", "-c", "exec -a veeloe sleep 30"]);
  cleanup.push(() => named.kill());
  writeFileSync(join(home, "runtime", "supervisor.pid"), `${named.pid}\n`);
  expect(supervisorPid(home)).toBe(named.pid);
});
