import { afterEach, expect, test } from "bun:test";
import { FAKE_KEY, fakeProvider, type FakeProvider } from "../providers/fake-provider";
import type { ProviderAuth } from "../providers/store";
import { PROXY_ERROR_HEADER, startLlmProxy } from "./proxy";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup(auth: ProviderAuth = "x-api-key", missing = false) {
  const provider: FakeProvider = fakeProvider({ auth });
  const proxy = startLlmProxy({
    route: (token) => (token !== "worker-token" ? undefined : missing ? { error: "provider.missing" } : { provider: { name: "main", url: provider.url, key: FAKE_KEY, auth }, model: "model-a" }),
  });
  cleanup.push(() => {
    proxy.stop();
    provider.server.stop(true);
  });
  const post = (path: string, body: unknown, token = "worker-token") =>
    fetch(`${proxy.url}${path}`, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  return { provider, proxy, post };
}

test.each(["x-api-key", "bearer"] as const)("a worker's request reaches the Provider with the key in %s and the Agent's model", async (auth) => {
  const { provider, post } = setup(auth);
  const response = await post("/v1/messages", { model: "the-most-expensive-one", max_tokens: 10, messages: [] });
  expect(response.status).toBe(200);
  expect((await response.json()).content).toEqual([{ type: "text", text: "hello" }]);
  const seen = provider.requests[0]!;
  expect(seen.body).toMatchObject({ model: "model-a", max_tokens: 10 });
  expect(seen.headers["anthropic-version"]).toBe("2023-06-01");
  expect(JSON.stringify(seen.headers)).not.toContain("worker-token");
});

test("a request without a token, or with one nobody was given, never reaches the Provider", async () => {
  const { provider, post } = setup();
  for (const token of ["", "guessed"]) {
    const response = await post("/v1/messages", {}, token);
    expect(response.status).toBe(401);
    expect(response.headers.get(PROXY_ERROR_HEADER)).toBe("proxy.unknown_worker");
  }
  expect(provider.requests).toEqual([]);
});

test("only the Messages endpoints pass, so the key cannot list or do anything else", async () => {
  const { provider, proxy } = setup();
  const list = await fetch(`${proxy.url}/v1/models`, { headers: { "x-api-key": "worker-token" } });
  expect(list.status).toBe(404);
  expect(provider.requests).toEqual([]);
});

test("a streamed answer passes through as it was sent", async () => {
  const { provider, post } = setup();
  const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  provider.reply = () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
  const response = await post("/v1/messages", { stream: true, messages: [] });
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(await response.text()).toBe(sse);
});

test("the Provider's own error comes back as the Provider said it", async () => {
  const { provider, post } = setup();
  provider.reply = () => Response.json({ type: "error", error: { type: "overloaded_error" } }, { status: 529 });
  const response = await post("/v1/messages", {});
  expect(response.status).toBe(529);
  expect(response.headers.get(PROXY_ERROR_HEADER)).toBeNull();
});

test("a Provider that is down, or one that was removed, is named in the proxy's own code", async () => {
  const down = setup();
  down.provider.server.stop(true);
  expect((await down.post("/v1/messages", {})).headers.get(PROXY_ERROR_HEADER)).toBe("provider.unreachable");

  const removed = setup("x-api-key", true);
  expect((await removed.post("/v1/messages", {})).headers.get(PROXY_ERROR_HEADER)).toBe("provider.missing");
  expect(removed.provider.requests).toEqual([]);
});
