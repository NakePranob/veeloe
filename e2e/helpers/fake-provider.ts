// Test helper, not a test: a stand-in for an Anthropic-format Provider.
import type { Server } from "bun";

export type FakeProvider = {
  url: string;
  server: Server<undefined>;
  /** Every request it got, headers lower-cased, except the ones naming a Task. */
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
  /** The requests that name a Task after its first done Turn: answered "Fixing CI", without `reply`, so a test's canned Turn answers stay in step. */
  titles: { headers: Record<string, string>; body: unknown }[];
  /** What `POST /v1/messages` answers; the default says hello. A Promise lets a test act before the answer lands. */
  reply: (body: { model?: string; messages?: unknown[]; stream?: boolean }) => Response | Promise<Response>;
};

export const FAKE_KEY = "test-provider-key";

/** Takes FAKE_KEY in the header `auth` names, as Anthropic (x-api-key) or a gateway (bearer) would. */
export function fakeProvider({ auth = "x-api-key" as "x-api-key" | "bearer" } = {}): FakeProvider {
  const provider = { requests: [], titles: [] } as unknown as FakeProvider;
  provider.reply = (body) => (body?.stream ? sse([{ type: "text", text: "hello" }]) : Response.json(message([{ type: "text", text: "hello" }])));
  provider.server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const headers = Object.fromEntries(req.headers);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      if (isTitle(body)) {
        provider.titles.push({ headers, body });
        return body.stream ? sse([{ type: "text", text: "Fixing CI" }]) : Response.json(message([{ type: "text", text: "Fixing CI" }]));
      }
      provider.requests.push({ method: req.method, path, headers, body });
      const given = auth === "bearer" ? headers.authorization : headers["x-api-key"];
      const want = auth === "bearer" ? `Bearer ${FAKE_KEY}` : FAKE_KEY;
      if (given !== want) return Response.json({ type: "error", error: { type: "authentication_error" } }, { status: 401 });
      if (req.method === "GET" && path === "/v1/models") return Response.json({ data: [{ id: "model-a", display_name: "Model A" }, { id: "model-b" }], has_more: false });
      if (req.method === "POST" && path === "/v1/messages") return provider.reply(body as never);
      return new Response("not found", { status: 404 });
    },
  });
  provider.url = `http://127.0.0.1:${provider.server.port}`;
  return provider;
}

/** The request the Runtime sends to name a Task, told apart by its system prompt. */
function isTitle(body: unknown): body is { stream?: boolean } {
  const system = (body as { system?: unknown } | null)?.system;
  return typeof system === "string" && system.startsWith("You name a conversation");
}

/** A whole Messages API answer around `content`. */
export function message(content: unknown[], stop_reason = "end_turn") {
  return { id: "msg_1", type: "message", role: "assistant", model: "model-a", content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
}

// The SSE a Provider streams for one message holding `content`.
export function sse(content: { type: string; [k: string]: unknown }[]) {
  const lines = [`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { ...message([]), content: [] } })}\n\n`];
  content.forEach((block, index) => {
    const start = block.type === "thinking" ? { type: "thinking", thinking: "", signature: "" } : { type: "text", text: "" };
    lines.push(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index, content_block: start })}\n\n`);
    if (block.type === "thinking") {
      lines.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } })}\n\n`);
      lines.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } })}\n\n`);
    } else lines.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } })}\n\n`);
    lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`);
  });
  lines.push(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } })}\n\n`);
  lines.push(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  return new Response(lines.join(""), { headers: { "content-type": "text/event-stream" } });
}

/** The SSE a Provider streams for one message that asks for one `bash` command. */
export function bashUseSse(command: string) {
  const start = JSON.stringify({ type: "message_start", message: { id: "msg_bash", type: "message", role: "assistant", model: "model-a", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const block = JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "bash", input: { command } } });
  const delta = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command }) } });
  const stop = JSON.stringify({ type: "content_block_stop", index: 0 });
  const end = JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } });
  return new Response([start, block, delta, stop, end, '{"type":"message_stop"}'].map((data) => `event: x\ndata: ${data}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
