/** The built-in Providers, in step with `packages/runtime/crates/runtime-supervisor/src/providers.rs` PRESETS. */
export const PROVIDER_PRESETS = [
  { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com" },
  { id: "opencode-go", name: "OpenCode Go", url: "https://opencode.ai/inference/go" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api" },
] as const;

export type ProviderPreset = (typeof PROVIDER_PRESETS)[number];
