import { createBackoff, createSigner, normalizeHubUrl, parseMessage, publicKeyOf, TASK_EVENTS_PAGE, toBase64url, verify } from "@veeloe/protocol";
import { createAgentRegistry } from "./agent-registry/registry";
import { createAgentsSlice } from "./agents/agents";
import type { Inbound, Outbox } from "./outbox";
import { startLlmProxy } from "./proxy/proxy";
import { createTaskMessageSlice } from "./task-message/task-message";
import { createTaskSyncSlice } from "./task-sync/task-sync";
import { createWorkers } from "./workers/workers";
import { ConfigError, loadConfig, runtimeHome } from "./config";
import { startHubLink } from "./hub-link/hub-link";
import { runPair } from "./pairing/pair";
import { KeyFileError, loadOrCreateMachineKey } from "./trust/machine-key";
import { FileSeenSequences, loadTrust, TrustFileError, trustedKeys } from "./trust/store";
import { runUnpair } from "./pairing/unpair";
import { runProviderCommand, type ProviderCommand } from "./providers/cli";
import { readKey } from "./providers/read-key";
import { loadProviders, ProviderError } from "./providers/store";

export type SupervisorOptions = {
  home: string;
  hubUrl: string;
  secretKey: Uint8Array;
  /** How to run this binary as a worker: `[veeloe]`, or `[bun, main.ts]` from source. */
  workerCommand: string[];
  log?: (line: string) => void;
  backoff?: ReturnType<typeof createBackoff>;
  fetchFn?: typeof fetch;
};

/**
 * The Machine's one connection to its Hub. Every envelope is checked against
 * the keys in trust and its sender's Member before any slice reads it (ADR 0006,
 * 0022), and every Agent has its own worker behind the LLM proxy (ADR 0020, 0042).
 */
export function startSupervisor({ home, hubUrl, secretKey, workerCommand, log = console.log, backoff, fetchFn }: SupervisorOptions) {
  const trust = loadTrust(home);
  if (trust.owners.length === 0) log("this Machine is not paired yet, so it takes no commands. Run: veeloe pair");
  const keys = trustedKeys(trust);
  const memberOf = new Map(trust.owners.flatMap((owner) => owner.keys.map((key) => [key, owner.member] as const)));
  const seen = new FileSeenSequences(home);
  const machineKey = toBase64url(publicKeyOf(secretKey));
  const signEnvelope = createSigner(secretKey, () => seen.next(machineKey));
  let machine: string | undefined;

  const registry = createAgentRegistry(home);
  const providers = () => loadProviders(home);
  const proxy = startLlmProxy({
    fetchFn,
    route(token) {
      const agent = registry.get(workers.agentOfToken(token) ?? "");
      if (!agent) return undefined;
      const provider = providers().find((p) => p.name === agent.provider);
      return provider ? { provider, model: agent.model } : { error: "provider.missing" };
    },
  });

  const outbox: Outbox = {
    toMember: (member, type, body, task) => void hub.send(signEnvelope({ type, recipients: [member], ...(task ? { task } : {}), body })),
    error: (to, code) => outbox.toMember(to.member, "error", { code, ref: to.ref }, to.task),
  };

  const workers = createWorkers({
    home,
    command: workerCommand,
    proxyUrl: proxy.url,
    log,
    onMessage(agent, message) {
      if (message.kind === "event") outbox.toMember(message.starter, "task.event", { agent, ...message.event }, message.task);
      else if (message.kind === "error") outbox.error({ member: message.member, ref: message.ref, task: message.task }, message.code);
      else if (message.kind === "events") {
        for (let i = 0; i === 0 || i < message.events.length; i += TASK_EVENTS_PAGE) outbox.toMember(message.member, "task.events", { agent, events: message.events.slice(i, i + TASK_EVENTS_PAGE) }, message.task);
      }
    },
  });
  for (const agent of registry.all()) workers.start(agent);

  const agents = createAgentsSlice({ registry, workers, providers, outbox, fetchFn });
  const taskMessage = createTaskMessageSlice({ registry, workers, outbox });
  const taskSync = createTaskSyncSlice({ registry, workers, outbox });

  const hub = startHubLink({
    hubUrl,
    secretKey,
    log,
    backoff,
    onReady: (id) => {
      machine = id;
    },
    onEnvelope: (value) => {
      const result = verify(value, keys, (route) => "to" in route && route.to === machine, seen);
      if (!result.ok) return log(`dropped an envelope: ${result.reason}`);
      // The Member comes from trust. A header naming someone else is dropped, not believed.
      const member = memberOf.get(result.from);
      if (!member || result.signed.member !== member) return log("dropped an envelope: member-mismatch");
      const from: Inbound = { member, ref: (value as { sig: string }).sig, task: result.signed.task };
      const parsed = parseMessage(result.signed);
      if (parsed.kind !== "message") return;
      const { message } = parsed;
      if (message.type === "agent.list") void agents.list(from);
      else if (message.type === "agent.create") void agents.create(from, message.body);
      else if (message.type === "task.message" && from.task) taskMessage({ ...from, task: from.task }, message.body);
      else if (message.type === "task.sync" && from.task) taskSync({ ...from, task: from.task }, message.body);
    },
  });

  return {
    workers,
    stop() {
      hub.stop();
      workers.stop();
      proxy.stop();
    },
  };
}

/** Turns what the operator can fix into a message and an exit, not a stack trace. */
async function reporting(work: () => unknown | Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof KeyFileError || err instanceof TrustFileError || err instanceof ProviderError) {
      console.error(`veeloe: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export function runSupervisor() {
  return reporting(() => {
    const config = loadConfig();
    const secretKey = loadOrCreateMachineKey(config.home);
    console.log(`veeloe supervisor, machine key ${toBase64url(publicKeyOf(secretKey))}`);
    // Compiled, the binary is the worker too. From source, Bun runs main.ts again.
    const workerCommand = Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main];
    startSupervisor({ home: config.home, hubUrl: config.hubUrl, secretKey, workerCommand });
  });
}

export function runPairCommand(hub: string | undefined) {
  return reporting(async () => {
    const { home, hubUrl } = hub ? { home: runtimeHome(), hubUrl: hub } : loadConfig();
    let normal: string;
    try {
      normal = normalizeHubUrl(hubUrl);
    } catch (err) {
      throw new ConfigError((err as Error).message);
    }
    const result = await runPair({ home, hubUrl: normal });
    process.exit(result === "paired" ? 0 : 1);
  });
}

export function runUnpairCommand() {
  return reporting(async () => {
    const done = await runUnpair({ home: runtimeHome() });
    process.exit(done ? 0 : 1);
  });
}

export function runProviderCommandLine(command: ProviderCommand) {
  return reporting(async () => {
    const done = await runProviderCommand(command, { home: runtimeHome(), readKey });
    process.exit(done ? 0 : 1);
  });
}
