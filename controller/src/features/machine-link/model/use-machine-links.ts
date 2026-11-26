import { randomUUID } from "expo-crypto";
import type { DeviceLink } from "@veeloe/protocol-ts";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useMachines } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { deviceName } from "../../../shared/device-name";
import { keySession, useKeyStatus } from "../../../shared/keystore";
import { NO_OUTPUT, type ToolOutput } from "./statuses";
import { createMachineLinks, UNKNOWN_MACHINE_STATUS, UNKNOWN_MEMORY, type MachineLinks, type MachineStatus, type MemoryStatus, type UsageStatus } from "./links";
import { UNKNOWN_TRIGGERS, type TriggerStatus } from "./statuses";

let current: MachineLinks | null = null;

// Fast Refresh runs this module again and starts from a fresh `current`, while the links it had
// keep their sockets open: two sets then take turns pushing each other off the Hub and writing at
// once. The live set is kept on globalThis too, so a new one always stops the one before it.
const kept = globalThis as { __veeloeMachineLinks?: MachineLinks | null };
const changes = new Set<() => void>();
const announce = () => {
  for (const listener of changes) listener();
};

/**
 * For the app layer: keeps the connections up while the key is open, and drops them when it locks.
 * `onRevoked` runs when a Hub says this key was revoked; `onLinked` when another device linked one.
 */
export function useMachineLinks({ onRevoked, onLinked }: { onRevoked: () => void; onLinked: (links: DeviceLink[]) => void }) {
  const database = useDatabase();
  const unlocked = useKeyStatus() === "unlocked";
  const machines = useMachines();
  const live = useCurrent();
  const handlers = useRef({ onRevoked, onLinked });
  handlers.current = { onRevoked, onLinked };

  useEffect(() => {
    const secretKey = unlocked ? keySession.secretKey() : null;
    if (!secretKey) return;
    kept.__veeloeMachineLinks?.stop();
    const links = createMachineLinks({ database, secretKey, newId: randomUUID, deviceName: deviceName(), onRevoked: () => handlers.current.onRevoked() });
    links.onLinked((news) => handlers.current.onLinked(news));
    current = links;
    kept.__veeloeMachineLinks = links;
    announce();
    return () => {
      links.stop();
      if (current === links) current = null;
      if (kept.__veeloeMachineLinks === links) kept.__veeloeMachineLinks = null;
      announce();
    };
  }, [database, unlocked]);

  // Every new set of links (a new key, a new database) gets the Machines, not only the first.
  useEffect(() => {
    if (machines && live) live.update(machines);
  }, [machines, live]);
}

function useCurrent() {
  return useSyncExternalStore(
    (listener) => {
      changes.add(listener);
      return () => void changes.delete(listener);
    },
    () => current,
  );
}

/** What pages send with. Null while locked. */
export function useMachineLink() {
  return useCurrent();
}

export function useMachineStatus(machine: string): MachineStatus {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribe(listener) ?? (() => {}),
    () => links?.status(machine) ?? UNKNOWN_MACHINE_STATUS,
  );
}

const NONE: Record<string, MachineStatus> = {};

/** Every Machine's status at once, for lists. */
export function useMachineStatuses(): Record<string, MachineStatus> {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribe(listener) ?? (() => {}),
    () => links?.statuses() ?? NONE,
  );
}

const NO_USAGES: Record<string, UsageStatus> = {};

/** Every Machine's usage request at once, for the page's list of Tasks. */
export function useUsageStatuses(): Record<string, UsageStatus> {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribeUsage(listener) ?? (() => {}),
    () => links?.usageStatuses() ?? NO_USAGES,
  );
}

/** One Agent's Memory as its Machine last answered, for the Memory page (`agent-memory-page`). */
/** The live output of one running command, as the Machine last sent it (ADR 0073). */
export function useToolOutput(toolUseId: string): ToolOutput {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribeOutput(listener) ?? (() => {}),
    () => links?.output(toolUseId) ?? NO_OUTPUT,
  );
}

export function useMemoryStatus(machine: string, agent: string): MemoryStatus {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribeMemory(listener) ?? (() => {}),
    () => links?.memory(machine, agent) ?? UNKNOWN_MEMORY,
  );
}

/** One Agent's Triggers as its Machine last listed them, for the Schedule page (issue #56). */
export function useTriggerStatus(machine: string, agent: string): TriggerStatus {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribeTriggers(listener) ?? (() => {}),
    () => links?.triggers(machine, agent) ?? UNKNOWN_TRIGGERS,
  );
}
