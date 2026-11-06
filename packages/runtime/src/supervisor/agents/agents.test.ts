import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import { createAgentRegistry } from "../agent-registry/registry";
import { budgetDay, createBudgets } from "../budget/budget";
import { createUsageStore } from "../usage/store";
import { FAKE_KEY, fakeProvider } from "../providers/fake-provider";
import type { Provider } from "../providers/store";
import { createAgentsSlice } from "./agents";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

const character = { color: "#9DC3E6", shell: "dome", top: "antenna", sides: "ears", decal: "none" };
const from = { member: "m_1", ref: "sig-1" };

function setup() {
  const fake = fakeProvider();
  cleanup.push(() => fake.server.stop(true));
  const home = mkdtempSync(join(tmpdir(), "veeloe-agents-"));
  const registry = createAgentRegistry(home);
  const store = createUsageStore({ home });
  cleanup.push(() => {
    store.close();
    rmSync(home, { recursive: true, force: true });
  });
  const budgets = createBudgets({ store });
  const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a", character };
  registry.add(agent);
  let providers: Provider[] = [
    { name: "main", url: fake.url, key: FAKE_KEY, auth: "x-api-key" },
    { name: "other", url: fake.url, key: FAKE_KEY, auth: "x-api-key" },
    { name: "down", url: "http://127.0.0.1:1", key: FAKE_KEY, auth: "x-api-key" },
  ];
  const sent: { member: string; type: string; body: unknown }[] = [];
  const renamed: Agent[] = [];
  const slice = createAgentsSlice({
    registry,
    workers: { start: () => {}, rename: (a) => void renamed.push(a) },
    providers: () => providers,
    egress: () => [],
    outbox: { toMember: (member, type, body) => void sent.push({ member, type, body }), error: (to, code) => void sent.push({ member: to.member, type: "error", body: { code } }) },
    members: () => ["m_1", "m_2"],
    budgets,
  });
  const errors = () => sent.filter((s) => s.type === "error").map((s) => (s.body as { code: string }).code);
  return { home, registry, budgets, slice, sent, renamed, errors, agent, setProviders: (p: Provider[]) => (providers = p) };
}

test("a new name changes only the name, reaches the worker, and every Member in trust hears of it", async () => {
  const s = setup();
  await s.slice.update(from, { id: "a1", name: "Deployer" });
  expect(s.registry.get("a1")).toEqual({ ...s.agent, name: "Deployer" });
  expect(s.renamed.map((a) => a.name)).toEqual(["Deployer"]);
  expect(s.sent.filter((m) => m.type === "agent.listed").map((m) => m.member)).toEqual(["m_1", "m_2"]);
});

test("a model alone is checked against the Agent's current Provider, and a Provider comes with its model", async () => {
  const s = setup();
  await s.slice.update(from, { id: "a1", model: "model-b" });
  expect(s.registry.get("a1")).toMatchObject({ provider: "main", model: "model-b" });
  await s.slice.update(from, { id: "a1", provider: "other", model: "model-a" });
  expect(s.registry.get("a1")).toMatchObject({ provider: "other", model: "model-a" });
  expect(s.renamed).toEqual([]);
  expect(s.errors()).toEqual([]);
});

test("an unknown Agent, a Provider the Machine lacks, a model not in the list or a Provider that cannot list writes nothing", async () => {
  const s = setup();
  await s.slice.update(from, { id: "ghost", name: "X" });
  await s.slice.update(from, { id: "a1", provider: "nope", model: "model-a" });
  await s.slice.update(from, { id: "a1", name: "Deployer", model: "no-such-model" });
  await s.slice.update(from, { id: "a1", provider: "down", model: "model-a" });
  expect(s.errors()).toEqual(["agent.unknown", "agent.provider_unknown", "agent.provider_unknown", "provider.unreachable"]);
  expect(s.registry.get("a1")).toEqual(s.agent);
  expect(s.renamed).toEqual([]);
  expect(s.sent.some((m) => m.type === "agent.listed")).toBe(false);
});

test("a Member not in trust may not change an Agent, and is not told it exists", async () => {
  const s = setup();
  await s.slice.update({ member: "m_stranger", ref: "sig-2" }, { id: "a1", name: "Mine" });
  expect(s.errors()).toEqual(["agent.unknown"]);
  expect(s.registry.get("a1")).toEqual(s.agent);
});

test("an Agent whose Provider was removed can be given another one", async () => {
  const s = setup();
  s.setProviders([]);
  await s.slice.update(from, { id: "a1", model: "model-b" });
  expect(s.errors()).toEqual(["agent.provider_unknown"]);
  const fake = fakeProvider();
  cleanup.push(() => fake.server.stop(true));
  s.setProviders([{ name: "new", url: fake.url, key: FAKE_KEY, auth: "x-api-key" }]);
  await s.slice.update(from, { id: "a1", provider: "new", model: "model-b" });
  expect(s.registry.get("a1")).toMatchObject({ provider: "new", model: "model-b" });
});

test("a Character is kept as sent, a part this build does not know included, and every change lasts a reopen", async () => {
  const s = setup();
  const look = { ...character, color: "#000000", shell: "orb", glow: true };
  await s.slice.update(from, { id: "a1", character: look, model: "model-b" });
  expect(createAgentRegistry(s.home).get("a1")).toEqual({ ...s.agent, model: "model-b", character: look });
});

test("a listed Agent carries its Budget and today's usage, and one made before the change gets the default", async () => {
  const s = setup();
  const listed = await s.slice.listed();
  expect(listed.agents[0]).toMatchObject({ id: "a1", budget: 10_000_000, usage: { day: budgetDay(Date.now()), tokens: 0 } });
});

test("a Budget alone changes without asking the Provider, even one that is down", async () => {
  const s = setup();
  s.setProviders([{ name: "main", url: "http://127.0.0.1:1", key: FAKE_KEY, auth: "x-api-key" }]);
  await s.slice.update(from, { id: "a1", budget: 5_000_000 });
  expect(s.errors()).toEqual([]);
  expect(s.registry.get("a1")).toMatchObject({ name: "A", provider: "main", model: "model-a", budget: 5_000_000 });
  expect(s.renamed).toEqual([]);
  expect(s.sent.filter((m) => m.type === "agent.listed")).toHaveLength(2);
});

test("a Budget sent with a model that fails changes nothing, and a Member without Manage cannot set one", async () => {
  const s = setup();
  await s.slice.update(from, { id: "a1", budget: 7_000_000, model: "no-such-model" });
  expect(s.errors()).toEqual(["agent.provider_unknown"]);
  expect(s.registry.get("a1")).toEqual(s.agent);
  await s.slice.update({ member: "m_stranger", ref: "sig-2" }, { id: "a1", budget: 7_000_000 });
  expect(s.errors()).toEqual(["agent.provider_unknown", "agent.unknown"]);
  expect(s.registry.get("a1")).toEqual(s.agent);
});

test("a Budget raised past today's tokens no longer counts the Agent as exhausted", async () => {
  const s = setup();
  s.budgets.add(s.agent, "", 10_000_000);
  expect(s.budgets.exhausted(s.registry.get("a1")!)).toBe(true);

  await s.slice.update(from, { id: "a1", budget: 20_000_000 });
  expect(s.budgets.exhausted(s.registry.get("a1")!)).toBe(false);
});
