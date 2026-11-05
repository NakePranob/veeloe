import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProviderCommand } from "./cli";
import { FAKE_KEY, fakeProvider } from "./fake-provider";
import { createAgentRegistry } from "../agent-registry/registry";
import { USER_AGENT } from "./presets";
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
  expect(lines).toContain("saved main with 2 models");
  expect(lines.at(-1)).toStartWith("Next:");
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
  expect(await run({ action: "remove", name: "main", yes: true })).toBe(true);
  expect(loadProviders(home)).toEqual([]);
  expect(readFileSync(join(home, "runtime/providers.json"), "utf8")).not.toContain(FAKE_KEY);
  expect(await run({ action: "remove", name: "main", yes: true })).toBe(false);
});

const never = async (): Promise<never> => {
  throw new Error("asked without a terminal");
};

test("a preset's auth is fixed, not detected: OpenRouter gets a bearer token although its model list is public", async () => {
  const { home, provider, lines } = setup("bearer");
  const fetchFn = ((url: string, init?: RequestInit) => fetch(url.replace("https://openrouter.ai/api", provider.url), init)) as typeof fetch;
  expect(await runProviderCommand({ action: "add", preset: "openrouter" }, { home, readKey: async () => FAKE_KEY, log: (l) => lines.push(l), fetchFn })).toBe(true);
  expect(loadProviders(home)).toEqual([{ name: "openrouter", url: "https://openrouter.ai/api", key: FAKE_KEY, auth: "bearer", preset: "openrouter" }]);
  expect(provider.requests).toHaveLength(1);
  expect(provider.requests[0]!.headers["user-agent"]).toBe(USER_AGENT);
});

test("without a terminal nothing is asked, and the missing flag is named", async () => {
  const { home, provider } = setup();
  const io = { home, readKey: never, ask: never, confirm: never, log: () => {} };
  await expect(runProviderCommand({ action: "add" }, io)).rejects.toThrow(/missing --name/);
  await expect(runProviderCommand({ action: "add", name: "main" }, io)).rejects.toThrow(/missing --url/);
  await expect(runProviderCommand({ action: "add", preset: "nope" }, io)).rejects.toThrow(/anthropic, opencode-go, openrouter/);
  await runProviderCommand({ action: "add", name: "main", url: provider.url }, { home, readKey: async () => FAKE_KEY, log: () => {} });
  await expect(runProviderCommand({ action: "remove" }, io)).rejects.toThrow(/missing the Provider's name/);
  await expect(runProviderCommand({ action: "remove", name: "main" }, io)).rejects.toThrow(/--yes/);
  expect(loadProviders(home)).toHaveLength(1);
});

test("the add wizard asks again until each answer is valid, then checks the key before saving", async () => {
  const { home, provider, lines } = setup();
  const answers = ["9", String(4), "Bad Name", "main", "http://example.com", provider.url];
  const asked: string[] = [];
  const ask = async (q: string) => (asked.push(q), answers.shift());
  expect(await runProviderCommand({ action: "add" }, { home, readKey: async () => FAKE_KEY, log: (l) => lines.push(l), interactive: true, ask })).toBe(true);
  expect(lines).toContain("  4) Custom (enter a URL)");
  expect(asked).toHaveLength(6);
  expect(loadProviders(home)).toEqual([{ name: "main", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }]);
});

test("remove names the Agents that use the Provider, and a no keeps it", async () => {
  const { home, provider, lines } = setup();
  await runProviderCommand({ action: "add", name: "main", url: provider.url }, { home, readKey: async () => FAKE_KEY, log: () => {} });
  createAgentRegistry(home).add({ id: "a1", name: "Deployer", provider: "main", model: "model-a" });
  createAgentRegistry(home).add({ id: "a2", name: "Other", provider: "elsewhere", model: "model-a" });
  const questions: string[] = [];
  const io = { home, readKey: never, log: (l: string) => lines.push(l), interactive: true, ask: async () => "1", confirm: async (q: string) => (questions.push(q), false) };
  expect(await runProviderCommand({ action: "remove" }, io)).toBe(false);
  expect(lines.join("\n")).toContain("Agents using main: Deployer. They stop answering");
  expect(lines.join("\n")).not.toContain("Other");
  expect(questions).toEqual(["Remove main?"]);
  expect(loadProviders(home)).toHaveLength(1);
  expect(await runProviderCommand({ action: "remove" }, { ...io, confirm: async () => true })).toBe(true);
  expect(loadProviders(home)).toEqual([]);
});
