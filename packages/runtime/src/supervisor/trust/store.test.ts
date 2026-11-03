import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSeenSequences, loadTrust, saveTrust, TrustFileError, trustedKeys } from "./store";

const dirs: string[] = [];
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-trust-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

test("a Machine with no file trusts nobody", () => {
  expect(loadTrust(tempHome())).toEqual({ owners: [] });
});

test("owners come back as saved, only the owner can read them, and no temporary file stays", () => {
  const home = tempHome();
  saveTrust(home, { owners: [{ member: "m_1", keys: ["key-1"] }] });
  expect(loadTrust(home)).toEqual({ owners: [{ member: "m_1", keys: ["key-1"] }] });
  expect(trustedKeys(loadTrust(home))).toEqual(new Set(["key-1"]));
  expect(statSync(join(home, "trust.json")).mode & 0o777).toBe(0o600);
  expect(readdirSync(home)).toEqual(["trust.json"]);
});

test("a leftover temporary file open to others does not pass its mode on", () => {
  const home = tempHome();
  writeFileSync(join(home, "trust.json.tmp"), "half", { mode: 0o644 });
  saveTrust(home, { owners: [] });
  expect(statSync(join(home, "trust.json")).mode & 0o777).toBe(0o600);
  expect(existsSync(join(home, "trust.json.tmp"))).toBe(false);
});

test.each([["not JSON", "{ half"], ["the wrong shape", '{"owners":[{"member":1}]}']])("a trust file with %s stops the Runtime", (_, content) => {
  const home = tempHome();
  writeFileSync(join(home, "trust.json"), content);
  expect(() => loadTrust(home)).toThrow(TrustFileError);
});

test("sequence numbers survive a restart", () => {
  const home = tempHome();
  new FileSeenSequences(home).record("key-1", 8);
  const after = new FileSeenSequences(home);
  expect(after.last("key-1")).toBe(8);
  expect(after.last("key-2")).toBeUndefined();
  expect(after.last("constructor")).toBeUndefined();
  expect(statSync(join(home, "seen.json")).mode & 0o777).toBe(0o600);
});

test("this Machine's own counter keeps going up across a restart", () => {
  const home = tempHome();
  const first = new FileSeenSequences(home);
  expect([first.next("me"), first.next("me")]).toEqual([1, 2]);
  expect(new FileSeenSequences(home).next("me")).toBe(3);
});
