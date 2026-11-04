import { join } from "node:path";
import { supervisorDir } from "../config";
import { readJsonFile, writeJsonFile } from "../json-file";

/** How this Provider takes its key: Anthropic reads x-api-key, gateways such as OpenRouter read a bearer token. */
export type ProviderAuth = "x-api-key" | "bearer";

/** A Provider set on this Machine (ADR 0042). Only the supervisor reads this file. */
export type Provider = { name: string; url: string; key: string; auth: ProviderAuth };

export class ProviderError extends Error {}

const file = (home: string) => join(supervisorDir(home), "providers.json");

export function loadProviders(home: string): Provider[] {
  let value: unknown;
  try {
    value = readJsonFile(file(home));
  } catch (err) {
    throw new ProviderError(`cannot read ${file(home)}: ${(err as Error).message}`);
  }
  return Array.isArray(value) ? (value as Provider[]) : [];
}

export function saveProviders(home: string, providers: Provider[]) {
  writeJsonFile(file(home), providers);
}

export function authHeaders({ key, auth }: Pick<Provider, "key" | "auth">): Record<string, string> {
  return auth === "bearer" ? { authorization: `Bearer ${key}` } : { "x-api-key": key };
}
