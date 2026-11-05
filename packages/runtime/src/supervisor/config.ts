import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { normalizeHubUrl } from "@veeloe/protocol";
import { writeJsonFile } from "./json-file";

export type Config = {
  /** The Runtime's folder: its key, its configuration, later its databases. */
  home: string;
  hubUrl: string;
};

export class ConfigError extends Error {}

/** The name this Machine pairs with: its host name. */
export const machineName = () => hostname().replace(/\.local$/, "");

/** The Runtime's folder is VEELOE_HOME (default ~/.veeloe), created owner-only. */
export function runtimeHome(env: Record<string, string | undefined> = process.env): string {
  const home = env.VEELOE_HOME || join(homedir(), ".veeloe");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

/**
 * The supervisor's own files (ADR 0032): trust, sequence numbers, Providers and
 * Agents. Files `machine-pairing` left at the top of the folder move in here.
 */
export function supervisorDir(home: string): string {
  const dir = join(home, "runtime");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const file of ["trust.json", "seen.json"]) {
    if (existsSync(join(home, file)) && !existsSync(join(dir, file))) renameSync(join(home, file), join(dir, file));
  }
  return dir;
}

/** What `veeloe pair` remembers, so plain `veeloe` needs no setting. */
export function saveHubUrl(home: string, hubUrl: string) {
  writeJsonFile(join(home, "config.json"), { hubUrl: normalizeHubUrl(hubUrl) });
}

/** The Hub URL is `hubUrl` in the folder's config.json, and VEELOE_HUB_URL overrides it. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = runtimeHome(env);

  const file = join(home, "config.json");
  let fromFile: { hubUrl?: unknown } = {};
  try {
    fromFile = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`cannot read ${file}: ${(err as Error).message}`);
  }

  const hubUrl = env.VEELOE_HUB_URL || (typeof fromFile.hubUrl === "string" ? fromFile.hubUrl : "");
  if (!hubUrl) {
    throw new ConfigError(`no Hub URL: run veeloe pair --hub <url>, set "hubUrl" in ${file}, or set the VEELOE_HUB_URL environment variable`);
  }
  try {
    normalizeHubUrl(hubUrl);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  return { home, hubUrl };
}
