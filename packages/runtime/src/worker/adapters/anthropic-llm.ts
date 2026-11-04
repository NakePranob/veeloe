import Anthropic, { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { LlmError, type Llm } from "../core/ports";

/** The header the supervisor's proxy names its own refusals in. */
const PROXY_ERROR_HEADER = "x-veeloe-error";

// ponytail: one ceiling for every model. Read it from the Provider's model list when a model needs more or allows less.
const MAX_TOKENS = 8192;

/**
 * The LLM, through the supervisor's proxy (ADR 0004, 0042). The SDK's key is the
 * worker's token: the proxy swaps in the Provider's key and the Agent's model,
 * so the model named here is a placeholder. Streams, because the SDK refuses a
 * plain request that might run long, and keeps only the finished message.
 */
export function anthropicLlm({ proxyUrl, token }: { proxyUrl: string; token: string }): Llm {
  const client = new Anthropic({ baseURL: proxyUrl, apiKey: token, maxRetries: 2 });
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
