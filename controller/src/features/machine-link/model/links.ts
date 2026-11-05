import { createBackoff, parseMessage, type ProviderInfo } from "@veeloe/protocol";
import { saveAgents } from "../../../entities/agent";
import { saveEgress, type Machine } from "../../../entities/machine";
import { addPendingMessage, failPendingMessage, listTasks, markPendingSent, saveTaskEvents } from "../../../entities/task";
import type { Database } from "../../../shared/db";
import { startHubClient } from "../../../shared/hub-client";

/** What this Controller knows of a Machine right now, beside what is in the database. */
export type MachineStatus = {
  /** Null until it has answered or the Hub said it is not there. */
  online: boolean | null;
  providers: ProviderInfo[] | null;
  /** The code the last `agent.create` came back with, if it failed. */
  createError: string | null;
};

const UNKNOWN: MachineStatus = { online: null, providers: null, createError: null };

type Client = ReturnType<typeof startHubClient>;

/**
 * One connection per Hub while the key is open (ADR 0021): on every connect it
 * asks each Machine for its Agents and every Task for what came after the last
 * event kept. What arrives is written to the database before anything shows it.
 * Only a Machine's own key is believed, and only for that Machine.
 */
export function createMachineLinks({ database, secretKey, newId, start = startHubClient }: { database: Database; secretKey: Uint8Array; newId: () => string; start?: typeof startHubClient }) {
  const clients = new Map<string, { client: Client; machines: Machine[] }>();
  const statuses = new Map<string, MachineStatus>();
  // A new object on every change, so React can tell that something moved.
  let all: Record<string, MachineStatus> = {};
  const listeners = new Set<() => void>();
  /** Which Machine an envelope went to, by its sig, so an answer about it finds its way back. */
  const sentTo = new Map<string, { machine: string; kind: "create" | "hello" | "other" }>();
  // The Hub does not say when a Machine comes back, so one that was offline is asked again, later each time.
  const retries = new Map<string, { timer: ReturnType<typeof setTimeout>; backoff: ReturnType<typeof createBackoff> }>();

  function setStatus(machine: string, change: Partial<MachineStatus>) {
    statuses.set(machine, { ...(statuses.get(machine) ?? UNKNOWN), ...change });
    all = Object.fromEntries(statuses);
    for (const listener of [...listeners]) listener();
  }

  function sendTo(machine: Machine, kind: "create" | "hello" | "other", out: { type: string; task?: string; body: unknown }) {
    const entry = clients.get(machine.hub_url);
    const member = entry?.client.member();
    if (!entry || !member) return null;
    const sig = entry.client.send({ ...out, to: machine.id, member });
    if (sig) sentTo.set(sig, { machine: machine.id, kind });
    return sig;
  }

  /** Its Agents, and every Task's events after the last one kept. */
  async function hello(machine: Machine) {
    const tasks = await listTasks(database);
    sendTo(machine, "hello", { type: "agent.list", body: {} });
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
    } else if ((message.type === "task.event" || message.type === "task.events") && signed.task) {
      const events = message.type === "task.event" ? [message.body] : message.body.events;
      await saveTaskEvents(database, { task: signed.task, agent: message.body.agent, machine: machine.id }, events);
    } else if (message.type === "error" && message.body.ref) {
      const about = sentTo.get(message.body.ref);
      if (about?.kind === "create") setStatus(machine.id, { createError: message.body.code });
      else await failPendingMessage(database, message.body.ref, message.body.code);
    }
  }

  function connect(hubUrl: string, machines: Machine[]) {
    const byKey = new Map(machines.map((m) => [m.public_key, m]));
    const client = start({
      hubUrl,
      secretKey,
      trustedKeys: byKey,
      onReady: () => machines.forEach((machine) => void hello(machine)),
      onEnvelope: ({ from, signed }) => {
        const machine = byKey.get(from);
        if (machine) void onEnvelope(machine, signed);
      },
      onHubError: (error) => {
        const about = error.ref ? sentTo.get(error.ref) : undefined;
        if (!about) return;
        if (error.code === "hub.machine_offline") {
          setStatus(about.machine, { online: false });
          const machine = machines.find((m) => m.id === about.machine);
          if (about.kind === "hello" && machine) helloLater(machine);
        }
        if (about.kind === "hello") return;
        if (about.kind === "create") setStatus(about.machine, { createError: error.code });
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

    /** The new Agent's id, or null when the Machine's Hub is not connected and nothing went. */
    createAgent(machine: Machine, agent: { name: string; provider: string; model: string }) {
      setStatus(machine.id, { createError: null });
      const id = newId();
      return sendTo(machine, "create", { type: "agent.create", body: { id, ...agent } }) ? id : null;
    },

    /**
     * The Machine's whole new Egress. The page asks for a fresh authentication
     * first (ADR 0012); the Machine answers with `agent.listed`, which is what
     * changes the list shown. False when the Hub is not connected and nothing went.
     */
    setEgress(machine: Machine, egress: string[]) {
      return sendTo(machine, "other", { type: "egress.set", body: { egress } }) !== null;
    },

    async sendMessage(machine: Machine, { agent, task, text }: { agent: string; task: string; text: string }) {
      const id = newId();
      await addPendingMessage(database, { id, task, agent, machine: machine.id, text });
      await markPendingSent(database, id, sendTo(machine, "other", { type: "task.message", task, body: { agent, id, text } }));
    },

    stop() {
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
