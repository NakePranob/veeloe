import { expect, test } from "bun:test";
import { parseMessage } from ".";
import { AgentListedBodySchema, AgentUpdateBodySchema, AgentUsageBodySchema } from "./agent";

const update = (body: unknown) => AgentUpdateBodySchema.safeParse(body);

test("a Budget is a whole number of tokens from 1 to 10^12", () => {
  for (const budget of [1, 10_000_000, 1_000_000_000_000]) expect([budget, update({ id: "a1", budget }).success]).toEqual([budget, true]);
  for (const budget of [0, -1, 1.5, 1_000_000_000_001, "10000000", null]) expect([budget, update({ id: "a1", budget }).success]).toEqual([budget, false]);
});

test("an update with only an id and a Budget says something, and one with nothing still says nothing", () => {
  expect(update({ id: "a1", budget: 20_000_000 }).success).toBe(true);
  expect(update({ id: "a1" }).success).toBe(false);
});

test("an Agent may carry a Budget and today's usage, and a listed Agent from a Machine without them still passes", () => {
  const agent = { id: "a1", name: "A", provider: "main", model: "model-a" };
  expect(AgentListedBodySchema.safeParse({ agents: [agent], providers: [] }).success).toBe(true);
  expect(AgentListedBodySchema.safeParse({ agents: [{ ...agent, budget: 10_000_000, usage: { day: "2026-11-06", tokens: 2400 } }], providers: [] }).success).toBe(true);
  expect(AgentListedBodySchema.safeParse({ agents: [{ ...agent, usage: { day: "6 November", tokens: 1 } }], providers: [] }).success).toBe(false);
});

test("agent.usage is a message this build reads, with the Agent, the day, its tokens and its Budget", () => {
  const body = { agent: "a1", day: "2026-11-06", tokens: 1700, budget: 10_000_000 };
  expect(AgentUsageBodySchema.safeParse(body).success).toBe(true);
  expect(parseMessage({ type: "agent.usage", body })).toEqual({ kind: "message", message: { type: "agent.usage", body } });
  expect(parseMessage({ type: "agent.usage", body: { ...body, tokens: -1 } })).toEqual({ kind: "invalid" });
});
