import { expect, test } from "bun:test";
import { providerProblem } from "./providers";

const agent = { provider: "main", model: "model-a" };

test("a Provider the Machine no longer lists, or a model its Provider no longer lists, is a problem", () => {
  expect(providerProblem(agent, [{ name: "other", models: [{ id: "model-a" }] }])).toBe("provider");
  expect(providerProblem(agent, [])).toBe("provider");
  expect(providerProblem(agent, [{ name: "main", models: [{ id: "model-b" }] }])).toBe("model");
  expect(providerProblem(agent, [{ name: "main", models: [{ id: "model-a" }] }])).toBeNull();
});

test("no warning while nobody can tell: no list from the Machine yet, or a Provider that could not list its models", () => {
  expect(providerProblem(agent, null)).toBeNull();
  expect(providerProblem(agent, [{ name: "main", error: "provider.unreachable" }])).toBeNull();
});
