import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentRegistry } from "./agent-registry/registry";
import { loadConfig, machineName, supervisorDir } from "./config";
import { loadProviders } from "./providers/store";
import { loadTrust } from "./trust/store";

const pidFile = (home: string) => join(supervisorDir(home), "supervisor.pid");

/** Marks this process as the supervisor of `home` until it exits. */
export function writePidFile(home: string) {
  const file = pidFile(home);
  writeFileSync(file, `${process.pid}\n`, { mode: 0o600 });
  process.on("exit", () => {
    if (supervisorPid(home) === process.pid) rmSync(file, { force: true });
  });
}

/**
 * The pid of the supervisor running for `home`, if one is. A file left by one
 * that was killed names a process that is gone, which reads as not running.
 *
 * ponytail: a pid the OS has since given to another process reads as running. Hold a lock on the file if that ever misleads.
 */
export function supervisorPid(home: string): number | undefined {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile(home), "utf8").trim());
  } catch {
    return undefined;
  }
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM" ? pid : undefined;
  }
}

/** `veeloe status`: what is set up on this Machine and what to do next. Never a key. */
export function runStatus({ home, env = process.env, log = console.log }: { home: string; env?: Record<string, string | undefined>; log?: (line: string) => void }) {
  const paired = loadTrust(home).owners.length > 0;
  let hub: string | undefined;
  try {
    hub = loadConfig({ ...env, VEELOE_HOME: home }).hubUrl;
  } catch {}
  const providers = loadProviders(home);
  const agents = createAgentRegistry(home).all();
  const pid = supervisorPid(home);

  log(`Machine     ${paired ? `paired as ${machineName()} with hub ${hub ?? "(no Hub URL set)"}` : "not paired"}`);
  log(`Runtime     ${pid ? `running (pid ${pid})` : "not running"}`);
  log(`Providers   ${providers.length ? "" : "none"}`);
  for (const p of providers) log(`  ${p.name}  ${p.preset ?? "custom"}  ${p.url}`);
  log(`Agents      ${agents.length ? "" : "none"}`);
  for (const a of agents) log(`  ${a.name}  ${providers.some((p) => p.name === a.provider) ? a.provider : `${a.provider} (removed)`}  ${a.model}`);

  const next = !paired
    ? "run veeloe to pair this Machine and add a Provider"
    : providers.length === 0
      ? "add a Provider with veeloe provider add"
      : !pid
        ? "start the Runtime with veeloe"
        : agents.length === 0
          ? "create an Agent in the Veeloe app"
          : "nothing; message your Agents in the Veeloe app";
  log(`\nNext: ${next}`);
}
