import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProviderCommand } from "./cli";
import { FAKE_KEY, fakeProvider } from "./fake-provider";
import { loadProviders, ProviderError } from "./store";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup(auth?: "x-api-key" | "bearer") {
  const home = mkdtempSync(join(tmpdir(), "veeloe-provider-"));
  const provider = fakeProvider({ auth });
  cleanup.push(() => {
    provider.server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });
  const lines: string[] = [];
  const run = (command: Parameters<typeof runProviderCommand>[0], key = FAKE_KEY) => runProviderCommand(command, { home, readKey: async () => `${key}\n`, log: (l) => lines.push(l) });
  return { home, provider, lines, run };
}

test.each(["x-api-key", "bearer"] as const)("a key the Provider takes in %s is saved with how to send it, owner-only", async (auth) => {
  const { home, provider, lines, run } = setup(auth);
  expect(await run({ action: "add", name: "main", url: `${provider.url}/` })).toBe(true);
  expect(lines.at(-1)).toBe("saved main with 2 models");
  expect(loadProviders(home)).toEqual([{ name: "main", url: provider.url, key: FAKE_KEY, auth }]);
  expect(statSync(join(home, "runtime/providers.json")).mode & 0o777).toBe(0o600);
});

test("a key the Provider refuses is not saved", async () => {
  const { home, provider, lines, run } = setup();
  expect(await run({ action: "add", name: "main", url: provider.url }, "wrong")).toBe(false);
  expect(lines.at(-1)).toContain("refused this key");
  expect(loadProviders(home)).toEqual([]);
});

test("a URL nobody answers is not saved", async () => {
  const { home, provider, lines, run } = setup();
  const url = provider.url;
  provider.server.stop(true);
  expect(await run({ action: "add", name: "main", url })).toBe(false);
  expect(lines.at(-1)).toContain("could not reach");
  expect(loadProviders(home)).toEqual([]);
});

test("a second Provider with the same name is refused and the first stays", async () => {
  const { home, provider, run } = setup();
  await run({ action: "add", name: "main", url: provider.url });
  await expect(run({ action: "add", name: "main", url: "https://other.example.com" })).rejects.toThrow(ProviderError);
  expect(loadProviders(home)[0]?.url).toBe(provider.url);
});

test("a key never goes to a remote host in clear text", async () => {
  const { run } = setup();
  await expect(run({ action: "add", name: "main", url: "http://api.example.com" })).rejects.toThrow(/https/);
});

test("list shows names and URLs and no part of the key, and remove takes one out", async () => {
  const { home, provider, lines, run } = setup();
  await run({ action: "add", name: "main", url: provider.url });
  lines.length = 0;
  await run({ action: "list" });
  expect(lines).toEqual([`main\t${provider.url}`]);
  expect(lines.join("")).not.toContain(FAKE_KEY.slice(0, 6));
  expect(await run({ action: "remove", name: "main" })).toBe(true);
  expect(loadProviders(home)).toEqual([]);
  expect(readFileSync(join(home, "runtime/providers.json"), "utf8")).not.toContain(FAKE_KEY);
  expect(await run({ action: "remove", name: "main" })).toBe(false);
});
