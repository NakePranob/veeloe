import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeHubUrl } from "@veeloe/protocol";

export type Config = {
  /** The Runtime's folder: its key, its configuration, later its databases. */
  home: string;
  hubUrl: string;
};

export class ConfigError extends Error {}

/**
 * The Runtime's folder is VEELOE_HOME (default ~/.veeloe), created owner-only.
 * The Hub URL is `hubUrl` in its config.json, and VEELOE_HUB_URL overrides it.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = env.VEELOE_HOME || join(homedir(), ".veeloe");
  mkdirSync(home, { recursive: true, mode: 0o700 });

  const file = join(home, "config.json");
  let fromFile: { hubUrl?: unknown } = {};
  try {
    fromFile = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`cannot read ${file}: ${(err as Error).message}`);
  }

  const hubUrl = env.VEELOE_HUB_URL || (typeof fromFile.hubUrl === "string" ? fromFile.hubUrl : "");
  if (!hubUrl) {
    throw new ConfigError(`no Hub URL: set "hubUrl" in ${file}, or the VEELOE_HUB_URL environment variable`);
  }
  try {
    normalizeHubUrl(hubUrl);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  return { home, hubUrl };
}
