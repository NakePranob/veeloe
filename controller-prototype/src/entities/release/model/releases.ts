import { createStore } from "../../../shared/lib";

const DAY = 86_400_000;
export const RELEASE_TTL = 7 * DAY;

// An Owner's signed release of a Machine, good for the next Pairing once (ADR 0035).
export interface Release {
  machineId: string;
  machineName: string;
  signedBy: string;
  signedAt: number;
  expiresAt: number;
  // Cancelled while the Machine was off: the command reaches it when it is back, and a
  // Pairing before then still moves it.
  cancelPending?: boolean;
}

// A Machine that left, kept so the screen can say what went where.
export interface Moved {
  machineId: string;
  machineName: string;
  at: number;
  agents: string[];
  tasks: number;
  grants: number;
}

const releases = createStore<Release[]>([]);
const moved = createStore<Moved[]>([]);

export const useReleases = releases.use;
export const getReleases = releases.get;
export const useMoved = moved.use;

export function useRelease(machineId: string | undefined) {
  return useReleases().find((release) => release.machineId === machineId);
}

export function getRelease(machineId: string) {
  return releases.get().find((release) => release.machineId === machineId);
}

export function signRelease(machineId: string, machineName: string, signedBy: string) {
  const now = Date.now();
  releases.set((all) => [...all.filter((release) => release.machineId !== machineId), { machineId, machineName, signedBy, signedAt: now, expiresAt: now + RELEASE_TTL }]);
}

export function patchRelease(machineId: string, patch: Partial<Release>) {
  releases.set((all) => all.map((release) => (release.machineId === machineId ? { ...release, ...patch } : release)));
}

export function dropRelease(machineId: string) {
  releases.set((all) => all.filter((release) => release.machineId !== machineId));
}

export function recordMoved(entry: Moved) {
  moved.set((all) => [...all, entry]);
}

export function useMovedOf(machineId: string | undefined) {
  return moved.use().find((entry) => entry.machineId === machineId);
}
