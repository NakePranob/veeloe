import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import type { Provider } from "../providers/store";
import { createTaskRoutes } from "./task-routes";

const p = (name: string): Provider => ({ name, url: `http://${name}.test`, key: "k", auth: "x-api-key" });
const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a" };
const both = [p("main"), p("other")];
const model = (r: ReturnType<ReturnType<typeof createTaskRoutes>>) => ("error" in r ? r.error : `${r.provider.name}/${r.model}`);

test("a Task keeps the model it started on after the Agent changes, across a restart, and a new Task gets the new one", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-routes-"));
  const route = createTaskRoutes(home);
  expect(model(route(agent, "t1", both))).toBe("main/model-a");
  const changed = { ...agent, provider: "other", model: "model-b" };
  expect(model(route(changed, "t1", both))).toBe("main/model-a");
  expect(model(route(changed, "t2", both))).toBe("other/model-b");
  expect(model(createTaskRoutes(home)(changed, "t1", both))).toBe("main/model-a");
});

test("a Task whose pinned Provider is gone moves to the Agent's current one, and stays there", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-routes-"));
  const route = createTaskRoutes(home);
  route(agent, "t1", both);
  expect(model(route(agent, "t1", [p("other")]))).toBe("provider.missing");
  const moved = { ...agent, provider: "other", model: "model-b" };
  expect(model(route(moved, "t1", [p("other")]))).toBe("other/model-b");
  expect(model(createTaskRoutes(home)(moved, "t1", both))).toBe("other/model-b");
});

test("a request with no Task, or a Task id like __proto__, pins nothing it should not", () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-routes-"));
  const route = createTaskRoutes(home);
  expect(model(route(agent, undefined, both))).toBe("main/model-a");
  route(agent, "__proto__", both);
  expect(model(createTaskRoutes(home)({ ...agent, model: "model-b" }, "__proto__", both))).toBe("main/model-a");
  expect(model(createTaskRoutes(home)({ ...agent, model: "model-b" }, "t9", both))).toBe("main/model-b");
});
