import { detectAuth, type ModelsProblem } from "./models";
import { loadProviders, ProviderError, saveProviders } from "./store";

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

const problemText: Record<ModelsProblem, string> = {
  "provider.rejected": "the Provider refused this key",
  "provider.unreachable": "could not reach the Provider at that URL",
  "provider.failed": "the Provider answered with an error",
};

/** A base URL without a trailing slash. Plain http only to this Machine, so a key never crosses a network in clear. */
export function providerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError(`not a URL: ${raw}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ProviderError(`the Provider URL must start with https:// (http:// only for this machine), got ${raw}`);
  if (url.search || url.hash || url.username || url.password) throw new ProviderError(`the Provider URL must be just its base, got ${raw}`);
  return url.href.replace(/\/+$/, "");
}

export type ProviderCommand = { action: "add"; name?: string; url?: string } | { action: "list" } | { action: "remove"; name?: string };

/** `veeloe provider add|list|remove`. The key is read by `readKey`, never taken as an argument. True when it worked. */
export async function runProviderCommand(command: ProviderCommand, { home, readKey, log = console.log, fetchFn }: { home: string; readKey: () => Promise<string>; log?: (line: string) => void; fetchFn?: typeof fetch }): Promise<boolean> {
  const providers = loadProviders(home);

  if (command.action === "list") {
    if (providers.length === 0) log("no Provider yet. Add one with: veeloe provider add --name <name> --url <base url>");
    for (const p of providers) log(`${p.name}\t${p.url}`);
    return true;
  }

  if (command.action === "remove") {
    const name = command.name;
    if (!name || !providers.some((p) => p.name === name)) {
      log(`no Provider named ${name ?? "(none given)"}`);
      return false;
    }
    saveProviders(home, providers.filter((p) => p.name !== name));
    log(`removed ${name}. Agents that used it will say so on their next message.`);
    return true;
  }

  const { name, url: rawUrl } = command;
  if (!name || !NAME.test(name)) throw new ProviderError("give the Provider a --name of lower-case letters, digits and dashes");
  if (!rawUrl) throw new ProviderError("give the Provider's base --url, such as https://api.anthropic.com or https://openrouter.ai/api");
  if (providers.some((p) => p.name === name)) throw new ProviderError(`a Provider named ${name} already exists. Remove it first: veeloe provider remove ${name}`);
  const url = providerUrl(rawUrl);

  const key = (await readKey()).trim();
  if (!key) throw new ProviderError("no key was given");
  const result = await detectAuth(url, key, { fetchFn });
  if (!result.ok) {
    log(`not saved: ${problemText[result.problem]}`);
    return false;
  }
  saveProviders(home, [...providers, { name, url, key, auth: result.auth }]);
  log(`saved ${name} with ${result.models.length} models`);
  return true;
}
