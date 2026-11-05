import { createBackoff, createSigner, normalizeHubUrl, parseMessage, publicKeyOf, TASK_EVENTS_PAGE, toBase64url, verify } from "@veeloe/protocol";
import { createAgentRegistry } from "./agent-registry/registry";
import { createAgentsSlice } from "./agents/agents";
import type { Inbound, Outbox } from "./outbox";
import { createEgressSlice, loadEgress } from "./egress/egress";
import { createLlmHandler } from "./proxy/proxy";
import { SandboxError, startSandbox, type Sandbox } from "./sandbox/sandbox";
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
  /** The OS sandbox every worker starts in (ADR 0008). */
  sandbox: Sandbox;
  log?: (line: string) => void;
  backoff?: ReturnType<typeof createBackoff>;
  fetchFn?: typeof fetch;
};

/**
 * The Machine's one connection to its Hub. Every envelope is checked against
 * the keys in trust and its sender's Member before any slice reads it (ADR 0006,
 * 0022), and every Agent has its own sandboxed worker, whose LLM requests come
 * over its IPC to the supervisor, which holds the keys (ADR 0008, 0020, 0042).
 */
export function startSupervisor({ home, hubUrl, secretKey, workerCommand, sandbox, log = console.log, backoff, fetchFn }: SupervisorOptions) {
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
  const llm = createLlmHandler({
    fetchFn,
    route(id) {
      const agent = registry.get(id);
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
    wrap: sandbox.wrap,
    llm,
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

  const egress = createEgressSlice({ home, apply: sandbox.setEgress, outbox, listed: () => agents.listed() });
  const agents = createAgentsSlice({ registry, workers, providers, egress: egress.current, outbox, fetchFn });
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
      // An Egress with one entry that is not a plain domain changes nothing, and says so.
      if (parsed.kind === "invalid" && result.signed.type === "egress.set") return outbox.error(from, "egress.invalid_domain");
      if (parsed.kind !== "message") return;
      const { message } = parsed;
      if (message.type === "agent.list") void agents.list(from);
      else if (message.type === "agent.create") void agents.create(from, message.body);
      else if (message.type === "task.message" && from.task) taskMessage({ ...from, task: from.task }, message.body);
      else if (message.type === "task.sync" && from.task) taskSync({ ...from, task: from.task }, message.body);
      else if (message.type === "egress.set") void egress.set(from, message.body);
    },
  });

  return {
    workers,
    stop() {
      hub.stop();
      workers.stop();
    },
  };
}

/** Turns what the operator can fix into a message and an exit, not a stack trace. */
async function reporting(work: () => unknown | Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof KeyFileError || err instanceof TrustFileError || err instanceof ProviderError || err instanceof SandboxError) {
      console.error(`veeloe: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export function runSupervisor() {
  return reporting(async () => {
    const config = loadConfig();
    const secretKey = loadOrCreateMachineKey(config.home);
    console.log(`veeloe supervisor, machine key ${toBase64url(publicKeyOf(secretKey))}`);
    // Before any worker: a Machine that cannot sandbox one runs none (ADR 0008).
    const sandbox = await startSandbox({ home: config.home, egress: loadEgress(config.home) });
    // Compiled, the binary is the worker too. From source, Bun runs main.ts again.
    const workerCommand = Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main];
    const running = startSupervisor({ home: config.home, hubUrl: config.hubUrl, secretKey, workerCommand, sandbox });
    // sandbox-runtime's own SIGINT and SIGTERM handlers only clean up, which would leave this running.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        running.stop();
        void sandbox.stop().finally(() => process.exit(0));
      });
    }
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
