import { createBackoff, createSigner, normalizeHubUrl, parseMessage, publicKeyOf, TASK_EVENTS_PAGE, toBase64url, verify } from "@veeloe/protocol";
import { createAgentRegistry } from "./agent-registry/registry";
import { createAgentsSlice } from "./agents/agents";
import { budgetDay, createBudgets } from "./budget/budget";
import type { Inbound, Outbox } from "./outbox";
import { createEgressSlice, loadEgress } from "./egress/egress";
import { createLlmHandler } from "./proxy/proxy";
import { createTaskRoutes } from "./proxy/task-routes";
import { SandboxError, startSandbox, type Sandbox } from "./sandbox/sandbox";
import { createTaskMessageSlice } from "./task-message/task-message";
import { createTaskListSlice } from "./task-list/task-list";
import { createTaskSyncSlice } from "./task-sync/task-sync";
import { createUsageStore, UsageError } from "./usage/store";
import { createUsageSlice } from "./usage/usage";
import { createWorkers } from "./workers/workers";
import { ConfigError, loadConfig, runtimeHome, saveHubUrl } from "./config";
import { startHubLink } from "./hub-link/hub-link";
import { runPair } from "./pairing/pair";
import { KeyFileError, loadOrCreateMachineKey } from "./trust/machine-key";
import { applyCertificates } from "./trust/certificates";
import { FileSeenSequences, loadTrust, saveTrust, TrustFileError, type Trust } from "./trust/store";
import { runUnpair } from "./pairing/unpair";
import { runProviderCommand, type ProviderCommand } from "./providers/cli";
import { readKey } from "./providers/read-key";
import { loadProviders, ProviderError } from "./providers/store";
import { runStatus, writePidFile } from "./status";
import { askLine, askOnTerminal, interactive, pickWithArrows } from "./terminal";

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
  let trust = loadTrust(home);
  if (trust.owners.length === 0) log("this Machine is not paired yet, so it takes no commands. Run: veeloe pair");
  const membersOf = (t: Trust) => new Map(t.owners.flatMap((owner) => owner.keys.map((key) => [key, owner.member] as const)));
  // Live, because a certificate can add or revoke a key while the Machine is connected.
  let memberOf = membersOf(trust);
  const keys = { has: (key: string) => memberOf.has(key) };
  const seen = new FileSeenSequences(home);
  const machineKey = toBase64url(publicKeyOf(secretKey));
  const signEnvelope = createSigner(secretKey, () => seen.next(machineKey));
  let machine: string | undefined;

  const registry = createAgentRegistry(home);
  // The tally Budget is enforced against and the history are one store (ADR 0066); the old file comes in once.
  const usageStore = createUsageStore({ home, log });
  usageStore.importLegacy();
  usageStore.prune(budgetDay(Date.now()));
  const budgets = createBudgets({ store: usageStore });
  const providers = () => loadProviders(home);
  const taskRoutes = createTaskRoutes(home);
  const membersInTrust = () => trust.owners.map((owner) => owner.member);
  const llm = createLlmHandler({
    fetchFn,
    log,
    allow: (id) => {
      const agent = registry.get(id);
      return !agent || !budgets.exhausted(agent);
    },
    // Every answer that reported tokens reaches every Member, which is who sets a Budget in v0.1 (ADR 0034, 0043).
    onUsage: (id, task, tokens) => {
      const agent = registry.get(id);
      if (!agent) return;
      const tally = budgets.add(agent, task ?? "", tokens);
      for (const member of membersInTrust()) outbox.toMember(member, "agent.usage", { agent: id, day: tally.day, tokens: tally.tokens, budget: budgets.limitOf(agent) });
    },
    route(id, task) {
      const agent = registry.get(id);
      return agent && taskRoutes(agent, task, providers());
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
      else if (message.kind === "tasks") outbox.toMember(message.member, "task.listed", { tasks: message.tasks.map((t) => ({ ...t, agent })) });
      else if (message.kind === "events") {
        for (let i = 0; i === 0 || i < message.events.length; i += TASK_EVENTS_PAGE) outbox.toMember(message.member, "task.events", { agent, events: message.events.slice(i, i + TASK_EVENTS_PAGE) }, message.task);
      }
    },
  });
  for (const agent of registry.all()) workers.start(agent);

  const egress = createEgressSlice({ home, apply: sandbox.setEgress, outbox, listed: () => agents.listed() });
  const agents = createAgentsSlice({ registry, workers, providers, egress: egress.current, outbox, fetchFn, members: membersInTrust, budgets });
  const taskMessage = createTaskMessageSlice({
    registry,
    workers,
    outbox,
    exhausted: (id) => {
      const agent = registry.get(id);
      return !!agent && budgets.exhausted(agent);
    },
  });
  const taskSync = createTaskSyncSlice({ registry, workers, outbox });
  const taskList = createTaskListSlice({ registry, workers });
  const usage = createUsageSlice({ registry, store: usageStore, outbox, members: membersInTrust });

  const hub = startHubLink({
    hubUrl,
    secretKey,
    log,
    backoff,
    onReady: (id) => {
      machine = id;
    },
    // Before any envelope on this connection, so a key linked or revoked while the Machine was off is settled first.
    onCertificates: (certificates) => {
      const next = applyCertificates(trust, certificates, log);
      if (JSON.stringify(next) === JSON.stringify(trust)) return;
      saveTrust(home, next);
      trust = next;
      memberOf = membersOf(next);
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
      else if (message.type === "agent.update") void agents.update(from, message.body);
      else if (message.type === "task.message" && from.task) taskMessage({ ...from, task: from.task }, message.body);
      else if (message.type === "task.sync" && from.task) taskSync({ ...from, task: from.task }, message.body);
      else if (message.type === "egress.set") void egress.set(from, message.body);
      else if (message.type === "task.list") taskList(from);
      else if (message.type === "usage.list") usage(from, message.body);
    },
  });

  return {
    workers,
    stop() {
      hub.stop();
      workers.stop();
      usageStore.close();
    },
  };
}

/** Turns what the operator can fix into a message and an exit, not a stack trace. */
async function reporting(work: () => unknown | Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof KeyFileError || err instanceof TrustFileError || err instanceof ProviderError || err instanceof SandboxError || err instanceof UsageError) {
      console.error(`veeloe: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

/** The terminal's answers, for the commands that ask. */
const terminalIo = () => ({ interactive: interactive(), ask: askLine, confirm: askOnTerminal, pick: pickWithArrows, readKey });

/** Pairs inline when it must, at a terminal. True when this Machine is paired. */
async function firstRun(home: string): Promise<boolean> {
  if (loadTrust(home).owners.length > 0) return true;
  if (!interactive()) {
    loadConfig(); // with no Hub URL, that is the first thing to say
    console.error("veeloe: this Machine is not paired yet. From a terminal, run:\n  veeloe pair       pair it with the Veeloe app\n  veeloe provider add\n  veeloe            start the Runtime");
    return false;
  }
  let hubUrl: string;
  try {
    hubUrl = loadConfig().hubUrl;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    const answer = await askLine("Hub URL (wss://... from the Veeloe app): ");
    if (!answer) throw new ConfigError("no Hub URL was given. Run veeloe again, or veeloe pair --hub <url>");
    try {
      hubUrl = normalizeHubUrl(answer);
    } catch (e) {
      throw new ConfigError((e as Error).message);
    }
    saveHubUrl(home, hubUrl);
  }
  console.log("This Machine is not paired yet. Pair it with the Veeloe app first.\n");
  if ((await runPair({ home, hubUrl })) !== "paired") return false;
  if (loadProviders(home).length === 0) {
    console.log("\nNext, add a Provider: the LLM your Agents use.\n");
    try {
      if (!(await runProviderCommand({ action: "add" }, { home, ...terminalIo() }))) console.log("You can add one later with: veeloe provider add");
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      console.log(`${err.message}\nYou can add one later with: veeloe provider add`);
    }
  }
  console.log("");
  return true;
}

export function runSupervisor() {
  return reporting(async () => {
    if (!(await firstRun(runtimeHome()))) process.exit(1);
    const config = loadConfig();
    if (loadProviders(config.home).length === 0) console.log("no Provider yet, so no Agent can answer. Add one with: veeloe provider add");
    const secretKey = loadOrCreateMachineKey(config.home);
    console.log(`veeloe supervisor, machine key ${toBase64url(publicKeyOf(secretKey))}`);
    // Before any worker: a Machine that cannot sandbox one runs none (ADR 0008).
    const sandbox = await startSandbox({ home: config.home, egress: loadEgress(config.home) });
    // Compiled, the binary is the worker too. From source, Bun runs main.ts again.
    const workerCommand = Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main];
    const running = startSupervisor({ home: config.home, hubUrl: config.hubUrl, secretKey, workerCommand, sandbox });
    writePidFile(config.home);
    console.log("Running. Stop it with Ctrl-C; see how this Machine is set up with: veeloe status");
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
    if (result === "paired") console.log(loadProviders(home).length ? "Next: start the Runtime with: veeloe" : "Next: add a Provider with veeloe provider add, then start the Runtime with: veeloe");
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
    const done = await runProviderCommand(command, { home: runtimeHome(), ...terminalIo() });
    process.exit(done ? 0 : 1);
  });
}

export function runStatusCommand() {
  return reporting(() => runStatus({ home: runtimeHome() }));
}
