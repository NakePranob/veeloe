import { version } from "../../../package.json";
import { authHeaders, type Provider, type ProviderAuth } from "./store";

/** How the Runtime names itself to every Provider; OpenCode asks clients to. */
export const USER_AGENT = `veeloe/${version}`;

/**
 * The built-in Providers, all answering in Anthropic Messages format. Their auth
 * is fixed, not detected: OpenRouter lists models without a key, so detection
 * would pick x-api-key for it.
 */
export type Preset = { id: string; label: string; url: string; auth: ProviderAuth; headers?: (task: string) => Record<string, string> };

export const PRESETS: Preset[] = [
  { id: "anthropic", label: "Anthropic", url: "https://api.anthropic.com", auth: "x-api-key" },
  // Go answers 400 MissingSessionID without a session that stays the same for one conversation.
  { id: "opencode-go", label: "OpenCode Go", url: "https://opencode.ai/inference/go", auth: "x-api-key", headers: (task) => ({ "x-opencode-session": task }) },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api", auth: "bearer" },
];

/** What every request to this Provider carries: its key, who is asking, and the preset's own headers for the Task it is for. */
export function upstreamHeaders(provider: Pick<Provider, "key" | "auth" | "preset">, task?: string): Record<string, string> {
  const preset = PRESETS.find((p) => p.id === provider.preset);
  return { ...authHeaders(provider), "user-agent": USER_AGENT, ...(task ? preset?.headers?.(task) : {}) };
}
