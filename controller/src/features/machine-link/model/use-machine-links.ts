import { randomUUID } from "expo-crypto";
import type { DeviceLink } from "@veeloe/protocol";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useMachines } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { deviceName } from "../../../shared/device-name";
import { keySession, useKeyStatus } from "../../../shared/keystore";
import { createMachineLinks, type MachineLinks, type MachineStatus, type UsageStatus } from "./links";

let current: MachineLinks | null = null;
const changes = new Set<() => void>();
const announce = () => changes.forEach((listener) => listener());

/**
 * For the app layer: keeps the connections up while the key is open, and drops them when it locks.
 * `onRevoked` runs when a Hub says this key was revoked; `onLinked` when another device linked one.
 */
export function useMachineLinks({ onRevoked, onLinked }: { onRevoked: () => void; onLinked: (links: DeviceLink[]) => void }) {
  const database = useDatabase();
  const unlocked = useKeyStatus() === "unlocked";
  const machines = useMachines();
  const handlers = useRef({ onRevoked, onLinked });
  handlers.current = { onRevoked, onLinked };

  useEffect(() => {
    const secretKey = unlocked ? keySession.secretKey() : null;
    if (!secretKey) return;
    const links = createMachineLinks({ database, secretKey, newId: randomUUID, deviceName: deviceName(), onRevoked: () => handlers.current.onRevoked() });
    links.onLinked((news) => handlers.current.onLinked(news));
    current = links;
    announce();
    return () => {
      links.stop();
      if (current === links) current = null;
      announce();
    };
  }, [database, unlocked]);

  useEffect(() => {
    if (machines && current) current.update(machines);
  }, [machines, unlocked]);
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

const UNKNOWN: MachineStatus = { online: null, providers: null, createError: null, updateError: null, stopError: null };

export function useMachineStatus(machine: string): MachineStatus {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribe(listener) ?? (() => {}),
    () => links?.status(machine) ?? UNKNOWN,
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

const NO_USAGE: UsageStatus = { request: null, days: null, loading: false, error: null, from: null, to: null, tasks: [], total: 0 };

/** One Machine's usage request: loading, or the code it failed with. */
export function useUsageStatus(machine: string): UsageStatus {
  const links = useCurrent();
  return useSyncExternalStore(
    (listener) => links?.subscribeUsage(listener) ?? (() => {}),
    () => links?.usage(machine) ?? NO_USAGE,
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
