import { afterEach, expect, test } from "bun:test";
import { FAKE_KEY, fakeProvider, type FakeProvider } from "../providers/fake-provider";
import type { ProviderAuth } from "../providers/store";
import { createLlmHandler, PROXY_ERROR_HEADER } from "./proxy";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup(auth: ProviderAuth = "x-api-key", missing = false, extra: { allow?: (agent: string) => boolean; onUsage?: (agent: string, task: string | undefined, tokens: number) => void } = {}) {
  const provider: FakeProvider = fakeProvider({ auth });
  const handle = createLlmHandler({
    route: (agent) => (agent !== "a1" ? undefined : missing ? { error: "provider.missing" } : { provider: { name: "main", url: provider.url, key: FAKE_KEY, auth }, model: "model-a" }),
    ...extra,
  });
  cleanup.push(() => provider.server.stop(true));
  const post = (path: string, body: unknown, agent = "a1") =>
    handle(agent, { method: "POST", path, headers: { "x-api-key": "placeholder", "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  return { provider, handle, post };
}

test.each(["x-api-key", "bearer"] as const)("a worker's request reaches the Provider with the key in %s and the Agent's model", async (auth) => {
  const { provider, post } = setup(auth);
  const response = await post("/v1/messages", { model: "the-most-expensive-one", max_tokens: 10, messages: [] });
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body).content).toEqual([{ type: "text", text: "hello" }]);
  const seen = provider.requests[0]!;
  expect(seen.body).toMatchObject({ model: "model-a", max_tokens: 10 });
  expect(seen.headers["anthropic-version"]).toBe("2023-06-01");
  expect(JSON.stringify(seen.headers)).not.toContain("placeholder");
});

test("a request from a worker whose Agent is gone never reaches the Provider", async () => {
  const { provider, post } = setup();
  const response = await post("/v1/messages", {}, "ghost");
  expect(response.status).toBe(401);
  expect(response.headers[PROXY_ERROR_HEADER]).toBe("proxy.unknown_worker");
  expect(provider.requests).toEqual([]);
});

test("only the Messages endpoints pass, so the key cannot list or do anything else", async () => {
  const { provider, handle, post } = setup();
  const list = await handle("a1", { method: "GET", path: "/v1/models", headers: {}, body: "" });
  expect(list.status).toBe(404);
  expect((await post("/v1/files", {})).headers[PROXY_ERROR_HEADER]).toBe("proxy.not_allowed");
  expect((await post("/v1/messages/../models", {})).headers[PROXY_ERROR_HEADER]).toBe("proxy.not_allowed");
  expect(provider.requests).toEqual([]);
});

test("a streamed answer comes back whole, as it was sent", async () => {
  const { provider, post } = setup();
  const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  provider.reply = () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
  const response = await post("/v1/messages", { stream: true, messages: [] });
  expect(response.headers["content-type"]).toBe("text/event-stream");
  expect(response.body).toBe(sse);
});

test("the Provider's own error comes back as the Provider said it", async () => {
  const { provider, post } = setup();
  provider.reply = () => Response.json({ type: "error", error: { type: "overloaded_error" } }, { status: 529 });
  const response = await post("/v1/messages", {});
  expect(response.status).toBe(529);
  expect(response.headers[PROXY_ERROR_HEADER]).toBeUndefined();
});

test("a Provider that is down, or one that was removed, is named in the supervisor's own code", async () => {
  const down = setup();
  down.provider.server.stop(true);
  expect((await down.post("/v1/messages", {})).headers[PROXY_ERROR_HEADER]).toBe("provider.unreachable");

  const removed = setup("x-api-key", true);
  expect((await removed.post("/v1/messages", {})).headers[PROXY_ERROR_HEADER]).toBe("provider.missing");
  expect(removed.provider.requests).toEqual([]);
});

test("a spent Budget refuses the next answer without asking the Provider, and says not to retry", async () => {
  const { provider, post } = setup("x-api-key", false, { allow: () => false });
  const response = await post("/v1/messages", { messages: [] });
  expect(response.status).toBe(429);
  expect(response.headers[PROXY_ERROR_HEADER]).toBe("budget.exhausted");
  expect(response.headers["x-should-retry"]).toBe("false");
  expect(provider.requests).toEqual([]);
});

test("count_tokens still passes with the Budget spent, and is never counted", async () => {
  const counted: number[] = [];
  const { provider, post } = setup("x-api-key", false, { allow: () => false, onUsage: (_agent, _task, tokens) => void counted.push(tokens) });
  const response = await post("/v1/messages/count_tokens", { messages: [] });
  // The stand-in Provider does not implement it, so its own 404 says the request got through.
  expect(response.status).toBe(404);
  expect(provider.requests.map((r) => r.path)).toEqual(["/v1/messages/count_tokens"]);
  expect(counted).toEqual([]);
});

test("an answer's usage is added to the Agent, and not one byte of what the worker gets changes", async () => {
  const counted: { agent: string; tokens: number }[] = [];
  const { provider, post } = setup("x-api-key", false, { onUsage: (agent, _task, tokens) => void counted.push({ agent, tokens }) });
  const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000,"cache_read_input_tokens":500}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":200}}\n\n';
  provider.reply = () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
  const response = await post("/v1/messages", { stream: true, messages: [] });
  expect(response.body).toBe(sse);
  expect(counted).toEqual([{ agent: "a1", tokens: 1700 }]);
});

test("an answer that says nothing of usage is not counted, and two Tasks on different models count into one Agent", async () => {
  const counted: { agent: string; tokens: number }[] = [];
  const logged: string[] = [];
  const provider = fakeProvider();
  cleanup.push(() => provider.server.stop(true));
  const handle = createLlmHandler({
    route: (agent, task) => (agent === "a1" ? { provider: { name: "main", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }, model: task === "t2" ? "model-b" : "model-a" } : undefined),
    onUsage: (agent, _task, tokens) => void counted.push({ agent, tokens }),
    log: (line) => void logged.push(line),
  });
  const post = (task: string) =>
    handle("a1", { method: "POST", path: "/v1/messages", headers: { "x-api-key": "placeholder", "content-type": "application/json", "x-veeloe-task": task }, body: JSON.stringify({ messages: [] }) });

  provider.reply = () => Response.json({ usage: { input_tokens: 10, output_tokens: 5 } });
  await post("t1");
  await post("t2");
  expect(provider.requests.map((r) => (r.body as { model: string }).model)).toEqual(["model-a", "model-b"]);
  expect(counted).toEqual([{ agent: "a1", tokens: 15 }, { agent: "a1", tokens: 15 }]);
  expect(logged).toEqual([]);

  provider.reply = () => Response.json({ content: [] });
  await post("t1");
  expect(counted).toHaveLength(2);
  // A gateway that leaves usage out says so in the log, since its Budget no longer protects.
  expect(logged).toEqual(["agent a1: the answer reported no usage, so its tokens were not counted"]);
});

test("the Task of the request is recorded with its tokens, and a request without one records none", async () => {
  const seen: { task: string | undefined; tokens: number }[] = [];
  const provider = fakeProvider();
  cleanup.push(() => provider.server.stop(true));
  const handle = createLlmHandler({
    route: () => ({ provider: { name: "main", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }, model: "model-a" }),
    onUsage: (_agent, task, tokens) => void seen.push({ task, tokens }),
  });
  provider.reply = () => Response.json({ usage: { input_tokens: 3, output_tokens: 4 } });
  const post = (headers: Record<string, string>) => handle("a1", { method: "POST", path: "/v1/messages", headers: { "x-api-key": "placeholder", ...headers }, body: JSON.stringify({ messages: [] }) });
  await post({ "x-veeloe-task": "t1" });
  await post({});
  expect(seen).toEqual([{ task: "t1", tokens: 7 }, { task: undefined, tokens: 7 }]);
});

test("a tally that cannot be written is logged and the Provider's answer still reaches the worker", async () => {
  const logged: string[] = [];
  const provider = fakeProvider();
  cleanup.push(() => provider.server.stop(true));
  const handle = createLlmHandler({
    route: () => ({ provider: { name: "main", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }, model: "model-a" }),
    onUsage: () => {
      throw new Error("disk full");
    },
    log: (line) => void logged.push(line),
  });
  provider.reply = () => Response.json({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 1, output_tokens: 1 } });
  const response = await handle("a1", { method: "POST", path: "/v1/messages", headers: { "x-api-key": "placeholder" }, body: JSON.stringify({ messages: [] }) });
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body).content).toEqual([{ type: "text", text: "hello" }]);
  expect(logged).toEqual(["agent a1: could not record 2 tokens (disk full)"]);
});
