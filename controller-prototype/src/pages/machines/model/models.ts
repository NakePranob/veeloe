// ponytail: the Runtime asks the Provider for its model list with the key it holds (ADR 0042).
// Here two known gateways answer and any other says nothing, so the context size falls back to 128K (ADR 0041).
export function askProvider(url: string): { models: string[]; contextSize: number } {
  const host = new URL(url).hostname;
  if (host.endsWith("anthropic.com")) return { models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], contextSize: 1_000_000 };
  if (host.endsWith("openrouter.ai")) return { models: ["anthropic/claude-sonnet-5-5", "z-ai/glm-5"], contextSize: 128_000 };
  return { models: ["default"], contextSize: 128_000 };
}
