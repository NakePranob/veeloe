import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_KEY, fakeProvider, sse } from "./supervisor/providers/fake-provider";
import { startLlmProxy } from "./supervisor/proxy/proxy";
import { anthropicLlm } from "./worker/adapters/anthropic-llm";
import { noTools } from "./worker/adapters/no-tools";
import { openEventStore } from "./worker/adapters/sqlite-store";
import { createAgentCore } from "./worker/core/agent";
import { LlmError } from "./worker/core/ports";

// The worker's LLM adapter through the supervisor's real proxy. It sits beside
// both, because neither half may import the other (ADR 0022).
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-seam-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "tasks.db");
}

function throughProxy() {
  const provider = fakeProvider();
  const proxy = startLlmProxy({ route: (t) => (t === "tok" ? { provider: { name: "p", url: provider.url, key: FAKE_KEY, auth: "x-api-key" }, model: "model-a" } : undefined) });
  cleanup.push(() => {
    proxy.stop();
    provider.server.stop(true);
  });
  return { provider, llm: anthropicLlm({ proxyUrl: proxy.url, token: "tok" }) };
}

test("a thinking block goes back to the LLM in the next request exactly as it came", async () => {
  const { provider, llm } = throughProxy();
  const thinking = { type: "thinking", thinking: "คิดก่อน \"ตอบ\"", signature: "c2lnbmF0dXJl" };
  provider.reply = () => sse([thinking, { type: "text", text: "สวัสดี" }]);
  const store = openEventStore(tempDb());
  const core = createAgentCore({ name: "A", store, llm, tools: noTools, link: { send: () => {} } });
  core.receive({ kind: "message", task: "t", id: "1", member: "m", text: "hi", ref: "s1" });
  await core.idle();
  provider.reply = () => sse([{ type: "text", text: "again" }]);
  core.receive({ kind: "message", task: "t", id: "2", member: "m", text: "more", ref: "s2" });
  await core.idle();

  const second = provider.requests.at(-1)!.body as { messages: { role: string; content: unknown[] }[]; model: string; stream: boolean };
  expect(second.model).toBe("model-a");
  expect(second.stream).toBe(true);
  expect(second.messages[1]).toEqual({ role: "assistant", content: [thinking, { type: "text", text: "สวัสดี" }] });
});

test("the proxy's and the Provider's failures come back as codes", async () => {
  const { provider, llm } = throughProxy();
  provider.reply = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 });
  await expect(llm.send({ system: "", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [] })).rejects.toEqual(new LlmError("provider.failed"));
  provider.server.stop(true);
  await expect(llm.send({ system: "", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [] })).rejects.toEqual(new LlmError("provider.unreachable"));
  const stranger = anthropicLlm({ proxyUrl: "http://127.0.0.1:1", token: "x" });
  await expect(stranger.send({ system: "", messages: [], tools: [] })).rejects.toEqual(new LlmError("provider.unreachable"));
}, 20_000);
