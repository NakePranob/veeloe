import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyFileError, loadOrCreateMachineKey } from "./machine-key";

const dirs: string[] = [];
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-key-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

test("the first start creates a key only the owner can read or write", () => {
  const home = tempHome();
  const key = loadOrCreateMachineKey(home);
  expect(key).toHaveLength(32);
  expect(statSync(join(home, "machine.key")).mode & 0o777).toBe(0o600);
});

test("a restart reuses the same key", () => {
  const home = tempHome();
  expect(loadOrCreateMachineKey(home)).toEqual(loadOrCreateMachineKey(home));
});

test("a key file open to other users stops the Runtime, naming the file and the mode it wants", () => {
  const home = tempHome();
  loadOrCreateMachineKey(home);
  const file = join(home, "machine.key");
  chmodSync(file, 0o644);
  expect(() => loadOrCreateMachineKey(home)).toThrow(KeyFileError);
  expect(() => loadOrCreateMachineKey(home)).toThrow(new RegExp(`${file}.*chmod 600`));
});

test("a key file of the wrong size is refused", () => {
  const home = tempHome();
  writeFileSync(join(home, "machine.key"), "short", { mode: 0o600 });
  expect(() => loadOrCreateMachineKey(home)).toThrow(/not a 32-byte key/);
});
