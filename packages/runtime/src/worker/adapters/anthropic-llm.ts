import Anthropic, { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import type { FromWorker, LlmResponse } from "../../ipc";
import { LlmError, type Llm } from "../core/ports";

/** The header the supervisor names its own refusals in. */
const PROXY_ERROR_HEADER = "x-veeloe-error";

// ponytail: one ceiling for every model. Read it from the Provider's model list when a model needs more or allows less.
const MAX_TOKENS = 8192;

/**
 * A `fetch` that goes over the worker's IPC to the supervisor (ADR 0008, 0042):
 * the sandbox lets a worker reach no port, the supervisor's included. `receive`
 * takes each `llm.response` the supervisor sends back.
 */
export function ipcFetch(send: (message: FromWorker) => void) {
  const pending = new Map<string, (answer: LlmResponse) => void>();
  let next = 0;
  return {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const { pathname, search } = new URL(req.url);
      const id = String(++next);
      const answer = new Promise<LlmResponse>((resolve) => pending.set(id, resolve));
      send({ kind: "llm.request", id, method: req.method, path: `${pathname}${search}`, headers: Object.fromEntries(req.headers), body: await req.text() });
      const { status, headers, body } = await answer;
      return new Response(body, { status, headers });
    }) as typeof fetch,
    receive(message: { id: string } & LlmResponse) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    },
  };
}

/**
 * The LLM, through the supervisor (ADR 0004, 0042). The SDK's key is a
 * placeholder and so is its model: the supervisor puts in the Provider's key
 * and the Agent's model. Streams, because the SDK refuses a plain request that
 * might run long, and keeps only the finished message.
 */
export function anthropicLlm({ fetch }: { fetch: typeof globalThis.fetch }): Llm {
  const client = new Anthropic({ baseURL: "http://supervisor", apiKey: "held-by-the-supervisor", fetch, maxRetries: 2 });
  return {
    async send({ system, messages, tools }) {
      try {
        const message = await client.messages
          .stream({ model: "agent", max_tokens: MAX_TOKENS, system, messages: messages as Anthropic.MessageParam[], ...(tools.length ? { tools: tools as Anthropic.Tool[] } : {}) })
          .finalMessage();
        // Through JSON, so what is kept is what the Provider sent and nothing the SDK hangs on it.
        return { content: JSON.parse(JSON.stringify(message.content)), stopReason: message.stop_reason };
      } catch (err) {
        if (err instanceof APIConnectionError) throw new LlmError("provider.unreachable");
        if (err instanceof APIError) throw new LlmError(err.headers?.get(PROXY_ERROR_HEADER) ?? "provider.failed");
        throw new LlmError("provider.failed");
      }
    },
  };
}
