import { createAgentRegistry } from "../agent-registry/registry";
import { choose } from "../terminal";
import { detectAuth, listModels, type Model, type ModelsProblem } from "./models";
import { PRESETS } from "./presets";
import { loadProviders, ProviderError, saveProviders, type Provider, type ProviderAuth } from "./store";

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NAME_RULE = "lower-case letters, digits and dashes, up to 32";

const problemText: Record<ModelsProblem, string> = {
  "provider.rejected": "the Provider refused this key. Check the key and run veeloe provider add again",
  "provider.unreachable": "could not reach the Provider at that URL. Check the URL and your connection, then run veeloe provider add again",
  "provider.failed": "the Provider answered with an error. Try again later, or check the URL",
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

export type ProviderCommand = { action: "add"; name?: string; url?: string; preset?: string } | { action: "list" } | { action: "remove"; name?: string; yes?: boolean };

export type ProviderIo = {
  home: string;
  /** The key, hidden. Never an argument: those stay in shell history and in `ps`. */
  readKey: () => Promise<string>;
  log?: (line: string) => void;
  fetchFn?: typeof fetch;
  /** Whether a person can answer. Without one nothing is asked, and what is missing is named. */
  interactive?: boolean;
  ask?: (question: string) => Promise<string | undefined>;
  confirm?: (question: string) => Promise<boolean>;
  /** One of `labels`, picked at the terminal. Undefined when cancelled. Defaults to a numbered pick through `ask`. */
  pick?: (title: string, labels: string[]) => Promise<number | undefined>;
};

const noAnswer = async () => undefined;

/** Asks until `check` takes the answer, or stdin closes. */
async function askValid<T>(ask: ProviderIo["ask"] & {}, log: (line: string) => void, question: string, check: (answer: string) => T): Promise<T> {
  for (;;) {
    const answer = await ask(question);
    if (answer === undefined) throw new ProviderError("cancelled, nothing was saved");
    try {
      return check(answer);
    } catch (err) {
      log((err as Error).message);
    }
  }
}

function checkName(name: string, providers: Provider[]) {
  if (!NAME.test(name)) throw new ProviderError(`a Provider name is ${NAME_RULE}, got "${name}"`);
  if (providers.some((p) => p.name === name)) throw new ProviderError(`a Provider named ${name} already exists. Pick another name, or remove it first: veeloe provider remove ${name}`);
  return name;
}

/**
 * `veeloe provider add|list|remove`. At a terminal a missing choice is asked;
 * anywhere else it is named and nothing is asked. True when it worked.
 */
export async function runProviderCommand(command: ProviderCommand, { home, readKey, log = console.log, fetchFn, interactive = false, ask = noAnswer, confirm = async () => false, pick = (title, labels) => choose(ask, log, title, labels) }: ProviderIo): Promise<boolean> {
  const providers = loadProviders(home);

  if (command.action === "list") {
    if (providers.length === 0) log("no Provider yet. Add one with: veeloe provider add");
    for (const p of providers) log(`${p.name}\t${p.url}`);
    return true;
  }

  if (command.action === "remove") {
    if (providers.length === 0) {
      log("there is no Provider to remove. Add one with: veeloe provider add");
      return false;
    }
    let name = command.name;
    if (!name) {
      if (!interactive) throw new ProviderError("missing the Provider's name: veeloe provider remove <name> --yes (see them with: veeloe provider list)");
      const i = await pick("Which Provider do you want to remove?", providers.map((p) => `${p.name}  ${p.url}`));
      if (i === undefined) throw new ProviderError("cancelled, nothing was removed");
      name = providers[i]!.name;
    }
    if (!providers.some((p) => p.name === name)) {
      log(`no Provider named ${name}. See them with: veeloe provider list`);
      return false;
    }
    const users = createAgentRegistry(home)
      .all()
      .filter((a) => a.provider === name)
      .map((a) => a.name);
    log(users.length ? `Agents using ${name}: ${users.join(", ")}. They stop answering until they are given another Provider.` : `no Agent uses ${name}.`);
    if (!command.yes) {
      if (!interactive) throw new ProviderError(`not removed: there is no terminal to confirm on. Run it again with --yes: veeloe provider remove ${name} --yes`);
      if (!(await confirm(`Remove ${name}?`))) {
        log("nothing was removed");
        return false;
      }
    }
    saveProviders(home, providers.filter((p) => p.name !== name));
    log(`removed ${name}. Next: add another with veeloe provider add, or see what is left with veeloe status`);
    return true;
  }

  // add: a preset, or a custom URL whose auth is detected.
  let { name, url, preset: presetId } = command;
  let auth: ProviderAuth | undefined;
  if (!presetId && !name && !url && interactive) {
    const i = await pick("Which Provider do you want to add?", [...PRESETS.map((p) => p.label), "Custom (enter a URL)"]);
    if (i === undefined) throw new ProviderError("cancelled, nothing was saved");
    presetId = PRESETS[i]?.id;
  }
  if (presetId) {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) throw new ProviderError(`no built-in Provider ${presetId}. Pick one of: ${PRESETS.map((p) => p.id).join(", ")}`);
    if (url) throw new ProviderError(`--preset ${preset.id} sets its own URL; drop --url, or leave out --preset for a custom Provider`);
    name = checkName(name ?? preset.id, providers);
    url = preset.url;
    auth = preset.auth;
  } else {
    if (name) checkName(name, providers);
    else if (interactive) name = await askValid(ask, log, "Name for this Provider: ", (a) => checkName(a, providers));
    else throw new ProviderError(`missing --name: veeloe provider add --name <name> --url <base url> (a name is ${NAME_RULE}), or --preset <${PRESETS.map((p) => p.id).join("|")}>`);
    if (url) url = providerUrl(url);
    else if (interactive) url = await askValid(ask, log, "Base URL (such as https://api.anthropic.com): ", providerUrl);
    else throw new ProviderError("missing --url: give the Provider's base URL, such as --url https://api.anthropic.com");
  }

  const key = (await readKey()).trim();
  if (!key) throw new ProviderError("no key was given. Type it when asked, or pipe it in: veeloe provider add ... < key-file");
  log(`checking ${url} ...`);
  let result: { ok: true; auth: ProviderAuth; models: Model[] } | { ok: false; problem: ModelsProblem };
  if (auth) {
    const fixed = auth;
    const listed = await listModels({ url, key, auth: fixed, preset: presetId }, { fetchFn });
    result = listed.ok ? { ok: true, auth: fixed, models: listed.models } : listed;
  } else result = await detectAuth(url, key, { fetchFn });
  if (!result.ok) {
    log(`not saved: ${problemText[result.problem]}`);
    return false;
  }
  saveProviders(home, [...providers, { name, url, key, auth: result.auth, ...(presetId ? { preset: presetId } : {}) }]);
  log(`saved ${name} with ${result.models.length} models`);
  log("Next: create an Agent with it in the Veeloe app. Start the Runtime with veeloe if it is not running.");
  return true;
}
