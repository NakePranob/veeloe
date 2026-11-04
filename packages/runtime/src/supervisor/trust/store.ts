import { join } from "node:path";
import type { SeenSequences } from "@veeloe/protocol";
import { supervisorDir } from "../config";
import { readJsonFile, writeJsonFile } from "../json-file";

export class TrustFileError extends Error {}

/** The keys this Machine takes commands from (ADR 0031). A list, because a Workspace will have many. */
export type Trust = { owners: { member: string; keys: string[] }[] };

function isTrust(value: unknown): value is Trust {
  const owners = (value as Trust | null)?.owners;
  return Array.isArray(owners) && owners.every((owner) => typeof owner?.member === "string" && Array.isArray(owner.keys) && owner.keys.every((key) => typeof key === "string"));
}

/** A broken file stops the Runtime instead of reading as "nobody is trusted", which `pair` would then overwrite. */
export function loadTrust(home: string): Trust {
  const file = join(supervisorDir(home), "trust.json");
  let value: unknown;
  try {
    value = readJsonFile(file);
  } catch (err) {
    throw new TrustFileError(`cannot read ${file}: ${(err as Error).message}`);
  }
  if (value === undefined) return { owners: [] };
  if (!isTrust(value)) throw new TrustFileError(`cannot read ${file}: it is not a list of owners`);
  return value;
}

export function saveTrust(home: string, trust: Trust) {
  writeJsonFile(join(supervisorDir(home), "trust.json"), trust);
}

export function trustedKeys(trust: Trust): Set<string> {
  return new Set(trust.owners.flatMap((owner) => owner.keys));
}

/**
 * The last sequence number per key, in seen.json, so a replay is still a replay
 * after a restart. It also holds this Machine's own key: the last number it sent.
 */
export class FileSeenSequences implements SeenSequences {
  #file: string;
  #last: Record<string, number>;

  constructor(home: string) {
    this.#file = join(supervisorDir(home), "seen.json");
    let value: unknown;
    try {
      value = readJsonFile(this.#file);
    } catch (err) {
      throw new TrustFileError(`cannot read ${this.#file}: ${(err as Error).message}`);
    }
    this.#last = (value ?? {}) as Record<string, number>;
  }

  last(senderKey: string) {
    return Object.hasOwn(this.#last, senderKey) ? this.#last[senderKey] : undefined;
  }

  record(senderKey: string, seq: number) {
    this.#last[senderKey] = seq;
    writeJsonFile(this.#file, this.#last);
  }

  /** The next number for this Machine to sign with. */
  next(ownKey: string) {
    const seq = (this.last(ownKey) ?? 0) + 1;
    this.record(ownKey, seq);
    return seq;
  }
}
