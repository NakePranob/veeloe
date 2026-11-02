// ponytail: stands in for the OAuth login. The real app opens the system browser, does PKCE,
// swaps the code for a token itself, seals it to the Machine's key and deletes its own copy; the
// Hub only relays the sealed box and never receives the redirect (ADR 0039).
export const ACCOUNT_OF: Record<string, string> = {
  github: "veeloe-bot (service account)",
  linear: "veeloe-bot@acme.example",
  brave: "API key ของทีม",
  firecrawl: "API key ของทีม",
};

export const botAccount = (service: string) => ACCOUNT_OF[service] ?? "service account";
export const ownAccount = (name: string, service: string) => `${name.toLowerCase()}@${service}.example`;
