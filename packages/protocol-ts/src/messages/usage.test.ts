import { expect, test } from "bun:test";
import { parseMessage } from ".";
import { UsageGetBodySchema, UsageListedBodySchema } from "./usage";

const get = (body: unknown) => UsageGetBodySchema.safeParse(body);
const listed = (body: unknown) => UsageListedBodySchema.safeParse(body);

const request = { request: "req-1", days: 7 };

test("a usage request names a request id and a whole number of days, and may name one Agent", () => {
  expect(get(request).success).toBe(true);
  expect(get({ ...request, agent: "agent-1" }).success).toBe(true);
  expect(get({ days: 7 }).success).toBe(false);
  expect(get({ request: "", days: 7 }).success).toBe(false);
  expect(get({ ...request, days: 7.5 }).success).toBe(false);
});

test("a usage answer carries the request it belongs to and the range the Machine chose", () => {
  expect(listed({ request: "req-1", from: "2026-10-31", to: "2026-11-06", agents: [] }).success).toBe(true);
  expect(listed({ request: "req-1", from: "31 October", to: "2026-11-06", agents: [] }).success).toBe(false);
  expect(listed({ request: "req-1", from: "2026-11-07", to: "2026-11-06", agents: [] }).success).toBe(false);
});

test("each Agent's answer keeps only the days it has, at most 20 Tasks and tokens that cannot be negative", () => {
  const agent = { agent: "agent-1", days: [{ day: "2026-11-06", tokens: 10 }], tasks: [{ task: "task-1", tokens: 10 }], sources: [{ source: "task", tokens: 10 }] };
  expect(listed({ request: "req-1", from: "2026-11-06", to: "2026-11-06", agents: [agent] }).success).toBe(true);
  expect(listed({ request: "req-1", from: "2026-11-06", to: "2026-11-06", agents: [{ ...agent, days: [{ day: "2026-11-06", tokens: -1 }] }] }).success).toBe(false);
  expect(listed({ request: "req-1", from: "2026-11-06", to: "2026-11-06", agents: [{ ...agent, tasks: Array.from({ length: 21 }, (_, i) => ({ task: `t${i}`, tokens: 1 })) }] }).success).toBe(false);
  expect(listed({ request: "req-1", from: "2026-11-06", to: "2026-11-06", agents: [{ ...agent, sources: [{ source: "Task", tokens: 1 }] }] }).success).toBe(false);
});

test("both usage messages are ones this build reads", () => {
  expect(parseMessage({ type: "usage.list", body: request })).toEqual({ kind: "message", message: { type: "usage.list", body: request } });
  const body = { request: "req-1", from: "2026-11-06", to: "2026-11-06", agents: [] };
  expect(parseMessage({ type: "usage.listed", body })).toEqual({ kind: "message", message: { type: "usage.listed", body } });
});
