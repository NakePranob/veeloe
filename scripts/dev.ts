/**
 * The local stack one command at a time: Postgres, the Hub API, the Rust Runtime
 * and Metro. It is what a person at this repo needs to see the app work, and what
 * this session kept doing by hand (start four processes, find their ports, pair a
 * device, seed an Agent).
 *
 *   bun run dev            # Postgres + Hub + Runtime + Metro
 *   bun run dev:pair       # the pairing link for a Controller
 *   bun run dev:seed       # one Agent with a MEMORY.md, for the Memory page
 *   bun run dev:status     # what is up, and on which port
 *   bun run dev:down       # stop everything this script started
 *
 * Pids go in `.dev/stack.json` and logs in `.dev/*.log`, so `down` stops exactly
 * what `up` started and never touches a Runtime or Hub someone else runs.
 */
import { connect } from "node:net";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRuntime } from "./runtime";

const repo = dirname(import.meta.dir);
const work = join(repo, ".dev");
const stackFile = join(work, "stack.json");
const hubDir = join(repo, "hub");
const controllerDir = join(repo, "controller");

type Started = { postgres?: number; hub?: number; runtime?: number; metro?: number };
type Proc = { proc: ReturnType<typeof Bun.spawn>; log: string };

const HOME_DIR = process.env.VEELOE_HOME ?? join(homedir(), ".veeloe");
const HUB_PORT = Number(process.env.HUB_PORT ?? 8080);
const METRO_PORT = Number(process.env.METRO_PORT ?? 8081);

function say(line: string) {
  console.log(line);
}

function fail(line: string): never {
  console.error(line);
  process.exit(1);
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readStack(): Started {
  try {
    return JSON.parse(readFileSync(stackFile, "utf8")) as Started;
  } catch {
    return {};
  }
}

function writeStack(stack: Started) {
  mkdirSync(work, { recursive: true });
  writeFileSync(stackFile, `${JSON.stringify(stack, null, 2)}\n`);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port: number, what: string, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await portOpen(port)) return;
    await Bun.sleep(300);
  }
  fail(`${what} did not open port ${port} within ${ms / 1000}s; see .dev/*.log`);
}

/** `KEY=value` lines of hub/.env, for `go run` which does not read the file itself. */
function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // `KEY=value   # what it is`: the shell a Makefile uses ends the value at a
      // whitespace-prefixed `#`, and values here never contain one unquoted.
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

/** One long-running child, its output in a log file, its pid kept for `down`. */
function spawnService(name: string, command: string[], cwd: string, env: Record<string, string>): Proc {
  mkdirSync(work, { recursive: true });
  const log = join(work, `${name}.log`);
  writeFileSync(log, `$ ${command.join(" ")}\n`);
  const fd = openSync(log, "a");
  try {
    const proc = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: fd, stderr: fd, stdin: "ignore", detached: true });
    if (!proc.pid) fail(`could not start ${name}`);
    // The child outlives this script: without unref, `up` would wait on it forever.
    proc.unref();
    return { proc, log };
  } finally {
    closeSync(fd);
  }
}

async function up() {
  const stack = readStack();
  let started = false;

  // Postgres is a container so the Hub's migrations and data survive a restart.
  if (!(await portOpen(5432))) {
    say("Postgres: docker compose up -d postgres");
    const docker = Bun.spawn(["docker", "compose", "up", "-d", "postgres"], { cwd: hubDir, stdout: "pipe", stderr: "pipe" });
    if ((await docker.exited) !== 0) fail(`Postgres did not start:\n${await new Response(docker.stderr).text()}`);
    started = true;
  }
  await waitForPort(5432, "Postgres", 60_000);

  const next: Started = { ...stack };
  if (!(await portOpen(HUB_PORT))) {
    say(`Hub: go run ./cmd/api on :${HUB_PORT}`);
    const hub = spawnService("hub", ["go", "run", "./cmd/api"], hubDir, { ...envFile(join(hubDir, ".env")), PORT: String(HUB_PORT) });
    next.hub = hub.proc.pid;
    started = true;
    writeStack(next);
    await waitForPort(HUB_PORT, "Hub");
  } else {
    say(`Hub: already listening on :${HUB_PORT}`);
  }

  if (!(await portOpen(METRO_PORT))) {
    say(`Metro: expo start --dev-client on :${METRO_PORT}`);
    const metro = spawnService("metro", ["bunx", "expo", "start", "--dev-client", "--port", String(METRO_PORT)], controllerDir, {});
    next.metro = metro.proc.pid;
    started = true;
    writeStack(next);
    await waitForPort(METRO_PORT, "Metro");
  } else {
    say(`Metro: already listening on :${METRO_PORT}`);
  }

  if (!alive(next.runtime)) {
    say("Runtime: building the debug supervisor");
    const binary = buildRuntime();
    say(`Runtime: VEELOE_HOME=${HOME_DIR}`);
    const runtime = spawnService("runtime", [binary], repo, { VEELOE_HOME: HOME_DIR, PATH: process.env.PATH ?? "" });
    next.runtime = runtime.proc.pid;
    started = true;
    writeStack(next);
  }

  writeStack(next);
  say("");
  if (!started) say("Everything was already up; nothing new was started.");
  say(`Stack up. Hub ws://localhost:${HUB_PORT} · Metro http://localhost:${METRO_PORT} · Runtime home ${HOME_DIR}`);
  say("Pair a Controller:  bun run dev:pair     Seed an Agent:  bun run dev:seed");
  say("`veeloe` on PATH (once): bun run dev:link");
  say("Logs: .dev/hub.log, .dev/runtime.log, .dev/metro.log");
}

async function down() {
  const stack = readStack();
  for (const name of ["metro", "runtime", "hub"] as const) {
    const pid = stack[name];
    if (!alive(pid)) continue;
    say(`Stopping ${name} (pid ${pid})`);
    // The pids are session leaders (`detached`), so the whole group goes: `go run`
    // and `bunx expo` each leave a child of their own.
    try {
      process.kill(-pid!, "SIGTERM");
    } catch {
      try {
        process.kill(pid!, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
  // Give them a moment to close their sockets before Postgres goes.
  const end = Date.now() + 5_000;
  while (Date.now() < end && Object.values(stack).some((pid) => alive(pid))) await Bun.sleep(200);

  const docker = Bun.spawn(["docker", "compose", "stop", "postgres"], { cwd: hubDir, stdout: "ignore", stderr: "ignore" });
  await docker.exited;
  rmSync(stackFile, { force: true });
  say("Stack down.");
}

async function status() {
  const stack = readStack();
  const rows: [string, number | undefined, number][] = [
    ["Postgres", undefined, 5432],
    ["Hub", stack.hub, HUB_PORT],
    ["Runtime", stack.runtime, 0],
    ["Metro", stack.metro, METRO_PORT],
  ];
  for (const [name, pid, port] of rows) {
    const running = name === "Postgres" || name === "Runtime" ? (port ? await portOpen(port) : alive(pid)) : alive(pid) && (await portOpen(port));
    const where = port ? `:${port}` : `pid ${pid ?? "?"}`;
    say(`${name.padEnd(8)} ${running ? "up" : "down"}  ${where}`);
  }
  say(`Home     ${HOME_DIR}${existsSync(HOME_DIR) ? "" : " (not created yet)"}`);
}

/**
 * Puts `veeloe` on PATH, pointing at the dev build, so `veeloe status` works from
 * anywhere in the repo instead of a full path. It is a symlink, not a copy: a new
 * build is picked up without linking again.
 */
async function link() {
  const binary = buildRuntime();
  const bin = join(homedir(), ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const target = join(bin, "veeloe");
  rmSync(target, { force: true });
  symlinkSync(binary, target);
  say(`${target} -> ${binary}`);
  say("Try: veeloe status" + (process.env.PATH?.split(":").includes(bin) ? "" : `  (add ${bin} to PATH)`));
}

/** Whether this Machine already trusts a Controller, from `trust.json`. */
function paired(): boolean {
  try {
    const trust = JSON.parse(readFileSync(join(HOME_DIR, "runtime", "trust.json"), "utf8")) as { owners?: unknown[] };
    return (trust.owners?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Restarts the Runtime so it picks up a key or Provider written while it ran. */
async function restartRuntime() {
  const stack = readStack();
  if (alive(stack.runtime)) {
    try {
      process.kill(-stack.runtime!, "SIGTERM");
    } catch {
      try {
        process.kill(stack.runtime!, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    const end = Date.now() + 5_000;
    while (Date.now() < end && alive(stack.runtime)) await Bun.sleep(100);
  }
  const binary = buildRuntime();
  const runtime = spawnService("runtime", [binary], repo, { VEELOE_HOME: HOME_DIR, PATH: process.env.PATH ?? "" });
  writeStack({ ...stack, runtime: runtime.proc.pid });
  say(`Runtime restarted (pid ${runtime.proc.pid})`);
}

async function pair() {
  // `veeloe pair` refuses a paired Machine, which reads like an error. Say what the
  // two real paths are instead: link another device from the app, or start over.
  if (paired()) {
    say("This Machine is already paired, so there is nothing to pair.");
    say("Add another Controller: open the app -> Workspace -> Devices -> Link a device (QR).");
    say("Start over instead:    bun run dev:unpair   then   bun run dev:pair");
    say("                        (unpair forgets every Controller and the Machine key)");
    return;
  }
  const wasRunning = alive(readStack().runtime);
  const binary = buildRuntime();
  const proc = Bun.spawn([binary, "pair"], { cwd: repo, env: { ...process.env, VEELOE_HOME: HOME_DIR }, stdio: ["inherit", "inherit", "inherit"] });
  const code = await proc.exited;
  // Pairing writes a new machine key; a Runtime already running still holds the old
  // one and would answer as a Machine the app no longer asks about (it looks offline).
  if (code === 0 && wasRunning) {
    say("Restarting the Runtime so it uses the key this pairing just wrote");
    await restartRuntime();
  }
  process.exit(code);
}

/**
 * Wipes the Controller's local database on a booted simulator (its key stays in
 * the keychain), after copying the database to `.dev/backup/`. The app comes back
 * with no Machine, so pairing it again is the next step. Use it when a stale
 * schema survives a reload and migrations cannot re-run on an open database.
 */
async function resetSim() {
  const bundle = process.env.SIM_BUNDLE ?? "dev.veeloe.controller";
  const device = process.env.SIMULATOR ?? "booted";
  const container = Bun.spawnSync(["xcrun", "simctl", "get_app_container", device, bundle, "data"]);
  if (container.exitCode !== 0) fail(`no ${bundle} on the simulator ${device}; install it with \`cd controller && bunx expo run:ios\``);
  const dir = container.stdout.toString().trim();

  Bun.spawnSync(["xcrun", "simctl", "terminate", device, bundle]);
  mkdirSync(join(work, "backup"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const name of ["veeloe.db", "veeloe.db-wal", "veeloe.db-shm"]) {
    const from = join(dir, "Documents", "SQLite", name);
    if (!existsSync(from)) continue;
    if (name === "veeloe.db") copyFileSync(from, join(work, "backup", `veeloe-${stamp}.db`));
    rmSync(from, { force: true });
  }
  Bun.spawnSync(["xcrun", "simctl", "launch", device, bundle]);
  say(`Reset ${bundle}; its database is backed up in .dev/backup/veeloe-${stamp}.db`);
  say("The app now has no Machine: pair it again with `bun run dev:pair`.");
}

/** `veeloe unpair` with its own y/N question on this terminal. */
async function unpair() {
  const binary = buildRuntime();
  const proc = Bun.spawn([binary, "unpair"], { cwd: repo, env: { ...process.env, VEELOE_HOME: HOME_DIR }, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}

function seed() {
  const id = process.argv[3] ?? "qa-memory";
  const name = process.argv[4] ?? "Pang";
  const providersFile = join(HOME_DIR, "runtime", "providers.json");
  const providers = JSON.parse(readFileSync(providersFile, "utf8")) as { name: string }[];
  if (!providers.length) fail(`no Provider in ${providersFile}: add one with \`veeloe provider add\` first`);
  const model = process.argv[5] ?? "model-a";

  const agentsFile = join(HOME_DIR, "runtime", "agents.json");
  mkdirSync(dirname(agentsFile), { recursive: true });
  const agents = existsSync(agentsFile) ? (JSON.parse(readFileSync(agentsFile, "utf8")) as { id: string }[]) : [];
  const row = { id, name, provider: providers[0].name, model, approvalTimeoutS: 3_600 };
  const without = agents.filter((agent) => agent.id !== id);
  writeFileSync(agentsFile, `${JSON.stringify([...without, row], null, 2)}\n`);

  const workdir = join(HOME_DIR, "agents", id, "workdir");
  mkdirSync(workdir, { recursive: true });
  const memory = join(workdir, "MEMORY.md");
  if (!existsSync(memory)) {
    writeFileSync(
      memory,
      "## ข้อตกลงถาวร\n- ตอบเป็นภาษาไทย กระชับ\n- รัน test ให้ผ่านก่อนบอกว่างานเสร็จ\n\n## สิ่งที่เคยแจ้งไปแล้ว\n- เจ้าของชอบชาเขียว ไม่ต้องถามซ้ำ\n",
    );
  }
  say(`Agent ${name} (${id})  provider ${row.provider}  model ${model}`);
  say(`Memory ${memory}`);
  say("Open the Agent in the Controller, then its Memory row; no restart of the Runtime is needed.");
}

const command = process.argv[2] ?? "up";
if (command === "up") await up();
else if (command === "down") await down();
else if (command === "status") await status();
else if (command === "pair") await pair();
else if (command === "unpair") await unpair();
else if (command === "reset-sim") await resetSim();
else if (command === "restart") await restartRuntime();
else if (command === "link") await link();
else if (command === "seed") seed();
else fail(`unknown command: ${command} (up | down | status | pair | seed)`);
