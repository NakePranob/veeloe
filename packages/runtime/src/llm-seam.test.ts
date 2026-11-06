import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FromWorker } from "./ipc";
import { FAKE_KEY, fakeProvider, sse } from "./supervisor/providers/fake-provider";
import { USER_AGENT } from "./supervisor/providers/presets";
import { createLlmHandler } from "./supervisor/proxy/proxy";
import { anthropicLlm, ipcFetch } from "./worker/adapters/anthropic-llm";
import { openEventStore } from "./worker/adapters/sqlite-store";
import { createAgentCore } from "./worker/core/agent";
import { LlmError, type ToolRunner } from "./worker/core/ports";

// The worker's LLM adapter through the supervisor's real handler, over a
// stand-in for the IPC between them, as JSON like Bun's. It sits beside both,
// because neither half may import the other (ADR 0022).
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

const noTools: ToolRunner = { definitions: () => [], run: async () => "" };

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "veeloe-seam-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "tasks.db");
}

function overIpc(preset?: string, extra: { allow?: (agent: string) => boolean } = {}) {
  const provider = fakeProvider();
  cleanup.push(() => provider.server.stop(true));
  const handle = createLlmHandler({
    route: (agent) => (agent === "a1" ? { provider: { name: "p", url: provider.url, key: FAKE_KEY, auth: "x-api-key", preset }, model: "model-a" } : undefined),
    ...extra,
  });
  const link = ipcFetch((message: FromWorker) => {
    if (message.kind !== "llm.request") return;
    const { id, kind: _, ...request } = JSON.parse(JSON.stringify(message)) as typeof message;
    void handle("a1", request).then((answer) => link.receive(JSON.parse(JSON.stringify({ id, ...answer }))));
  });
  return { provider, llm: anthropicLlm({ fetch: link.fetch }) };
}

test("a thinking block goes back to the LLM in the next request exactly as it came", async () => {
  const { provider, llm } = overIpc();
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
  expect(JSON.stringify(provider.requests.at(-1)!.headers)).not.toContain("held-by-the-supervisor");
});

test("the supervisor's and the Provider's failures come back as codes", async () => {
  const { provider, llm } = overIpc();
  const ask = () => llm.send({ task: "t", system: "", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [] });
  provider.reply = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 });
  await expect(ask()).rejects.toEqual(new LlmError("provider.failed"));
  provider.server.stop(true);
  await expect(ask()).rejects.toEqual(new LlmError("provider.unreachable"));
}, 20_000);

test("OpenCode Go gets the Task's id as its session, and every Provider learns the request is from veeloe", async () => {
  for (const [preset, session] of [["opencode-go", "task-42"], [undefined, undefined]] as const) {
    const { provider, llm } = overIpc(preset);
    const core = createAgentCore({ name: "A", store: openEventStore(tempDb()), llm, tools: noTools, link: { send: () => {} } });
    core.receive({ kind: "message", task: "task-42", id: "1", member: "m", text: "hi", ref: "s1" });
    await core.idle();
    const headers = provider.requests.at(-1)!.headers;
    expect(headers["x-opencode-session"]).toBe(session as never);
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(headers["x-api-key"]).toBe(FAKE_KEY);
    expect(Object.keys(headers).filter((h) => h.startsWith("x-veeloe"))).toEqual([]);
  }
});

test("a spent Budget reaches the SDK as one refusal with its own code, and the Provider is never asked", async () => {
  let asked = 0;
  const { provider, llm } = overIpc(undefined, {
    allow: () => {
      asked++;
      return false;
    },
  });
  const ask = () => llm.send({ task: "t", system: "", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [] });
  await expect(ask()).rejects.toEqual(new LlmError("budget.exhausted"));
  expect(provider.requests).toEqual([]);
  // One request over IPC, so the SDK did not try again after the refusal.
  expect(asked).toBe(1);
});
