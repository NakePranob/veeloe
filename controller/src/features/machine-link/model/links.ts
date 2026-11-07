import { createBackoff, parseMessage, publicKeyOf, toBase64url, type AgentCreateBody, type AgentUpdateBody, type ApprovalAnswerBody, type DeviceLink, type HubLinkRequest, type ProviderInfo, type SignedPart } from "@veeloe/protocol";
import { saveCertificates } from "../../../entities/device";
import { saveAgents, saveUsage } from "../../../entities/agent";
import { saveEgress, type Machine } from "../../../entities/machine";
import { addListedTasks, addPendingMessage, failPendingMessage, listTasks, markPendingSent, saveTaskEvents } from "../../../entities/task";
import { saveUsageFetchedAt, saveUsageHistory } from "../../../entities/usage";
import type { Database } from "../../../shared/db";
import { createSeenSequences, startHubClient } from "../../../shared/hub-client";

/** What this Controller knows of a Machine right now, beside what is in the database. */
export type MachineStatus = {
  /** Null until it has answered or the Hub said it is not there. */
  online: boolean | null;
  providers: ProviderInfo[] | null;
  /** The code the last `agent.create` came back with, if it failed. */
  createError: string | null;
  /** The code the last `agent.update` came back with, if it failed. */
  updateError: string | null;
  /** The code the last `task.stop` came back with, if it failed (`stop-and-restart`). */
  stopError: string | null;
};

const UNKNOWN: MachineStatus = { online: null, providers: null, createError: null, updateError: null, stopError: null };

/** One page's usage request for one Machine: what it asked for, and how it went. */
export type UsageStatus = {
  request: string | null;
  days: number | null;
  loading: boolean;
  /** A code from the Hub or the Machine, such as `hub.machine_offline` or `usage.invalid_range`. */
  error: string | null;
  /** The range the Machine chose, which its own clock defines; null before its first answer. */
  from: string | null;
  to: string | null;
  /** The biggest Tasks of that answer, for the page's list; only held in memory. */
  tasks: { agent: string; task: string; tokens: number }[];
  /** The answer's total for its range, so the "other" row comes from the same answer as the Tasks. */
  total: number;
};

const UNKNOWN_USAGE: UsageStatus = { request: null, days: null, loading: false, error: null, from: null, to: null, tasks: [], total: 0 };

type Client = ReturnType<typeof startHubClient>;
/** What an envelope was, so the error about it lands in the right place. */
type Kind = "create" | "update" | "stop" | "hello" | "usage" | "other";

/**
 * One connection per Hub while the key is open (ADR 0021): on every connect it
 * asks each Machine for its Agents and every Task for what came after the last
 * event kept. What arrives is written to the database before anything shows it.
 * Only a Machine's own key is believed, and only for that Machine.
 */
export function createMachineLinks({
  database,
  secretKey,
  newId,
  deviceName = "",
  onRevoked,
  start = startHubClient,
}: {
  database: Database;
  secretKey: Uint8Array;
  newId: () => string;
  /** This device's own name, for the device list until a certificate names it. */
  deviceName?: string;
  /** The Hub closed with 4403: this key was revoked. */
  onRevoked?: () => void;
  start?: typeof startHubClient;
}) {
  const ownKey = toBase64url(publicKeyOf(secretKey));
  const clients = new Map<string, { client: Client; machines: Machine[] }>();
  /** Keys of this Member's other devices that a page waits to hear from, such as a new device being linked. */
  const watchers = new Map<string, (signed: SignedPart) => void>();
  const linkListeners = new Set<(links: DeviceLink[]) => void>();
  const requestListeners = new Set<(hubUrl: string, request: HubLinkRequest) => void>();
  const statuses = new Map<string, MachineStatus>();
  // A new object on every change, so React can tell that something moved.
  let all: Record<string, MachineStatus> = {};
  const listeners = new Set<() => void>();
  const usageStatuses = new Map<string, UsageStatus>();
  // A new object on every change, so React can tell that something moved.
  let allUsage: Record<string, UsageStatus> = {};
  const usageListeners = new Set<() => void>();
  /** Which Machine an envelope went to, by its sig, so an answer about it finds its way back. */
  const sentTo = new Map<string, { machine: string; kind: Kind; request?: string }>();
  // The Hub does not say when a Machine comes back, so one that was offline is asked again, later each time.
  const retries = new Map<string, { timer: ReturnType<typeof setTimeout>; backoff: ReturnType<typeof createBackoff> }>();

  function setStatus(machine: string, change: Partial<MachineStatus>) {
    statuses.set(machine, { ...(statuses.get(machine) ?? UNKNOWN), ...change });
    all = Object.fromEntries(statuses);
    for (const listener of [...listeners]) listener();
  }

  function setUsage(machine: string, change: Partial<UsageStatus>) {
    usageStatuses.set(machine, { ...(usageStatuses.get(machine) ?? UNKNOWN_USAGE), ...change });
    allUsage = Object.fromEntries(usageStatuses);
    for (const listener of [...usageListeners]) listener();
  }

  function sendTo(machine: Machine, kind: Kind, out: { type: string; task?: string; body: unknown }, request?: string) {
    const entry = clients.get(machine.hub_url);
    const member = entry?.client.member();
    if (!entry || !member) return null;
    const sig = entry.client.send({ ...out, to: machine.id, member });
    if (sig) sentTo.set(sig, { machine: machine.id, kind, ...(request ? { request } : {}) });
    return sig;
  }

  /** Its Agents, and every Task's events after the last one kept. */
  async function hello(machine: Machine) {
    const tasks = await listTasks(database);
    sendTo(machine, "hello", { type: "agent.list", body: {} });
    // What this Member started there, for a device that has not seen it all (ADR 0021, 0060).
    sendTo(machine, "other", { type: "task.list", body: {} });
    for (const task of tasks.filter((t) => t.machine_id === machine.id)) sendTo(machine, "other", { type: "task.sync", task: task.id, body: { agent: task.agent_id, after: task.synced_seq } });
  }

  function helloLater(machine: Machine) {
    const retry = retries.get(machine.id) ?? { timer: undefined as never, backoff: createBackoff({ baseMs: 3000, capMs: 30_000 }) };
    clearTimeout(retry.timer);
    retry.timer = setTimeout(() => void hello(machine), Math.max(1000, retry.backoff.next()));
    retries.set(machine.id, retry);
  }

  async function onEnvelope(machine: Machine, signed: { type: string; task?: string; body: unknown }) {
    const parsed = parseMessage(signed);
    if (parsed.kind !== "message") return;
    const { message } = parsed;
    if (message.type === "agent.listed") {
      const retry = retries.get(machine.id);
      if (retry) {
        clearTimeout(retry.timer);
        retries.delete(machine.id);
      }
      await saveAgents(database, machine.id, message.body.agents);
      // A Machine older than `sandboxed-commands` says nothing of it, which is not the same as an empty Egress.
      if (message.body.egress) await saveEgress(database, machine.id, message.body.egress);
      setStatus(machine.id, { online: true, providers: message.body.providers });
    } else if (message.type === "agent.usage") {
      // The tally of an answer already given, kept before anything shows it; older news never wins (`daily-budget`).
      await saveUsage(database, message.body);
    } else if (message.type === "usage.listed") {
      const current = usageStatuses.get(machine.id);
      // An answer to an older window is dropped whole: its days would otherwise show up in the current one.
      if (!current || current.request !== message.body.request) return;
      await saveUsageHistory(database, machine.id, message.body);
      await saveUsageFetchedAt(database, machine.id, Date.now());
      setUsage(machine.id, {
        loading: false,
        error: null,
        from: message.body.from,
        to: message.body.to,
        total: message.body.agents.reduce((sum, agent) => sum + agent.days.reduce((all, day) => all + day.tokens, 0), 0),
        tasks: message.body.agents.flatMap((agent) => agent.tasks.map((task) => ({ agent: agent.agent, ...task }))),
      });
    } else if ((message.type === "task.event" || message.type === "task.events") && signed.task) {
      const events = message.type === "task.event" ? [message.body] : message.body.events;
      await saveTaskEvents(database, { task: signed.task, agent: message.body.agent, machine: machine.id }, events);
    } else if (message.type === "task.listed") {
      for (const task of await addListedTasks(database, machine.id, message.body.tasks)) sendTo(machine, "other", { type: "task.sync", task: task.id, body: { agent: task.agent, after: 0 } });
    } else if (message.type === "error" && message.body.ref) {
      const about = sentTo.get(message.body.ref);
      if (about?.kind === "create") setStatus(machine.id, { createError: message.body.code });
      else if (about?.kind === "update") setStatus(machine.id, { updateError: message.body.code });
      else if (about?.kind === "stop") setStatus(machine.id, { stopError: message.body.code });
      else if (about?.kind === "usage") {
        const current = usageStatuses.get(about.machine);
        if (current && current.request === about.request) setUsage(about.machine, { loading: false, error: message.body.code });
      } else await failPendingMessage(database, message.body.ref, message.body.code);
    }
  }

  // The last envelope number from each sender lives in the database, not this process (`protocol-envelope`).
  const { seen, ready: seenReady } = createSeenSequences(database);

  function connect(hubUrl: string, machines: Machine[]) {
    const byKey = new Map(machines.map((m) => [m.public_key, m]));
    const client = start({
      hubUrl,
      secretKey,
      seen,
      seenReady,
      trustedKeys: { has: (key) => byKey.has(key) || watchers.has(key) },
      onReady: (member) => {
        // A Hub with no certificate yet sends none, and this device is still the first one.
        void saveCertificates(database, { member, own: ownKey, ownName: deviceName }, []);
        machines.forEach((machine) => void hello(machine));
      },
      onEnvelope: ({ from, signed }) => {
        const machine = byKey.get(from);
        if (machine) void onEnvelope(machine, signed);
        else watchers.get(from)?.(signed);
      },
      onCertificates: (certificates) => {
        const member = client.member();
        if (!member) return;
        void saveCertificates(database, { member, own: ownKey, ownName: deviceName }, certificates).then((news) => {
          if (news.length) for (const listener of [...linkListeners]) listener(news);
        });
      },
      onLinkRequest: (request) => {
        for (const listener of [...requestListeners]) listener(hubUrl, request);
      },
      onRevoked: () => onRevoked?.(),
      onHubError: (error) => {
        const about = error.ref ? sentTo.get(error.ref) : undefined;
        if (!about) return;
        if (error.code === "hub.machine_offline") {
          setStatus(about.machine, { online: false });
          const machine = machines.find((m) => m.id === about.machine);
          if (about.kind === "hello" && machine) helloLater(machine);
        }
        if (about.kind === "hello") return;
        if (about.kind === "usage") {
          const current = usageStatuses.get(about.machine);
          if (current && current.request === about.request) setUsage(about.machine, { loading: false, error: error.code });
          return;
        }
        if (about.kind === "create") setStatus(about.machine, { createError: error.code });
        else if (about.kind === "update") setStatus(about.machine, { updateError: error.code });
        else if (about.kind === "stop") setStatus(about.machine, { stopError: error.code });
        else void failPendingMessage(database, error.ref!, error.code);
      },
    });
    clients.set(hubUrl, { client, machines });
  }

  return {
    /** Starts, restarts or stops a connection wherever the Machines on a Hub changed. */
    update(machines: Machine[]) {
      // Not Map.groupBy: Hermes does not have it.
      const byHub = new Map<string, Machine[]>();
      for (const m of machines) byHub.set(m.hub_url, [...(byHub.get(m.hub_url) ?? []), m]);
      for (const [hubUrl, entry] of clients) {
        const now = byHub.get(hubUrl);
        if (!now || now.map((m) => m.public_key).join() !== entry.machines.map((m) => m.public_key).join()) {
          for (const m of entry.machines) {
            clearTimeout(retries.get(m.id)?.timer);
            retries.delete(m.id);
          }
          entry.client.stop();
          clients.delete(hubUrl);
        }
      }
      for (const [hubUrl, onHub] of byHub) if (!clients.has(hubUrl)) connect(hubUrl, onHub);
    },

    status: (machine: string) => statuses.get(machine) ?? UNKNOWN,
    statuses: () => all,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /**
     * Asks a Machine for how the last `days` Budget days went. The answer is cached
     * before the page hears of it, and the request id keeps a slow answer from an
     * older window out of the page. Null when the Hub is not connected and nothing went.
     */
    requestUsage(machine: Machine, days: number) {
      const current = usageStatuses.get(machine.id);
      if (current?.loading && current.days === days) return current.request;
      const request = newId();
      setUsage(machine.id, { request, days, loading: true, error: null });
      if (!sendTo(machine, "usage", { type: "usage.list", body: { request, days } }, request)) {
        setUsage(machine.id, { request, days, loading: false, error: "hub.machine_offline" });
        return null;
      }
      return request;
    },

    usage: (machine: string) => usageStatuses.get(machine) ?? UNKNOWN_USAGE,
    usageStatuses: () => allUsage,
    subscribeUsage(listener: () => void) {
      usageListeners.add(listener);
      return () => void usageListeners.delete(listener);
    },

    /** The new Agent's id, or null when the Machine's Hub is not connected and nothing went. The Machine keeps `character` with it. */
    createAgent(machine: Machine, agent: Omit<AgentCreateBody, "id">) {
      setStatus(machine.id, { createError: null });
      const id = newId();
      return sendTo(machine, "create", { type: "agent.create", body: { id, ...agent } }) ? id : null;
    },

    /**
     * Only the fields that change (`agent-settings`). Nothing shows as changed until the Machine's
     * `agent.listed` says so (ADR 0006). The sig, or null when the Hub is not connected and nothing went.
     */
    updateAgent(machine: Machine, body: AgentUpdateBody) {
      setStatus(machine.id, { updateError: null });
      return sendTo(machine, "update", { type: "agent.update", body });
    },

    /**
     * The Machine's whole new Egress. The page asks for a fresh authentication
     * first (ADR 0012); the Machine answers with `agent.listed`, which is what
     * changes the list shown. False when the Hub is not connected and nothing went.
     */
    setEgress(machine: Machine, egress: string[]) {
      return sendTo(machine, "other", { type: "egress.set", body: { egress } }) !== null;
    },

    /**
     * Stops the Turn running in this Task (ADR 0017). Nothing shows as stopped until
     * the Machine's `turn.stopped` event lands. `id` makes a resend stop nothing twice.
     * The sig, or null when the Hub is not connected and nothing went.
     */
    stopTurn(machine: Machine, { agent, task, id }: { agent: string; task: string; id: string }) {
      setStatus(machine.id, { stopError: null });
      return sendTo(machine, "stop", { type: "task.stop", task, body: { agent, id } });
    },

    /**
     * The answer to one waiting Approval. Nothing shows as answered until the
     * Machine's `approval.answered` event says so (ADR 0006). The sig, or null
     * when the Hub is not connected and nothing went.
     */
    answerApproval(machine: Machine, { agent, task, request, decision, message, allowAlways }: Omit<ApprovalAnswerBody, "agent"> & { agent: string; task: string }) {
      return sendTo(machine, "other", { type: "approval.answer", task, body: { agent, request, decision, ...(message !== undefined && { message }), ...(allowAlways !== undefined && { allowAlways }) } });
    },

    async sendMessage(machine: Machine, { agent, task, text }: { agent: string; task: string; text: string }) {
      // A new message means the Member moved on from whatever a Stop said (ADR 0017).
      setStatus(machine.id, { stopError: null });
      const id = newId();
      await addPendingMessage(database, { id, task, agent, machine: machine.id, text });
      await markPendingSent(database, id, sendTo(machine, "other", { type: "task.message", task, body: { agent, id, text } }));
    },

    /**
     * To this Member's other devices on that Hub (`hub-relay` lets a Controller name only its own Member).
     * The envelope's sig, or null when that Hub is not connected and nothing went.
     */
    sendToSelf(hubUrl: string, type: string, body: unknown) {
      const client = clients.get(hubUrl)?.client;
      const member = client?.member();
      return client && member ? client.send({ type, recipients: [member], body }) : null;
    },

    /** Reads what `key`, another device of this Member, signs to this one, until the returned function is called. */
    watch(key: string, handler: (signed: SignedPart) => void) {
      watchers.set(key, handler);
      return () => void (watchers.get(key) === handler && watchers.delete(key));
    },

    /** Hears of a device another of this Member's devices just linked (ADR 0031). */
    onLinked(listener: (links: DeviceLink[]) => void) {
      linkListeners.add(listener);
      return () => void linkListeners.delete(listener);
    },

    /** Hears the link requests a Hub hands this device, unchecked: the page showing the QR checks them against its secret. */
    onLinkRequest(listener: (hubUrl: string, request: HubLinkRequest) => void) {
      requestListeners.add(listener);
      return () => void requestListeners.delete(listener);
    },

    ownKey,

    stop() {
      watchers.clear();
      linkListeners.clear();
      requestListeners.clear();
      for (const { timer } of retries.values()) clearTimeout(timer);
      retries.clear();
      for (const { client } of clients.values()) client.stop();
      clients.clear();
      statuses.clear();
      all = {};
      for (const listener of [...listeners]) listener();
    },
  };
}

export type MachineLinks = ReturnType<typeof createMachineLinks>;
