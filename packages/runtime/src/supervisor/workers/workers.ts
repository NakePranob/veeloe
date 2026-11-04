import { join } from "node:path";
import { createBackoff, type Agent } from "@veeloe/protocol";
import type { FromWorker, ToWorker } from "../../ipc";
import { agentDir } from "../agent-registry/registry";

type Running = { process: ReturnType<typeof Bun.spawn>; token: string; ready: boolean; waiting: ToWorker[]; startedAt: number };

// A worker that lived this long counts as having started fine, so its next crash waits the shortest time again.
const HEALTHY_MS = 60_000;

export type Workers = ReturnType<typeof createWorkers>;

/**
 * One worker process per Agent (ADR 0020), started from the same binary. A
 * worker that ends without being told is started again, later each time.
 * Messages wait for a worker that is starting, and come back as
 * `agent.unavailable` if it dies before it reads them.
 */
export function createWorkers({
  home,
  command,
  proxyUrl,
  onMessage,
  log = console.log,
  backoff = () => createBackoff({ capMs: 30_000 }),
}: {
  home: string;
  /** How to run this binary: `[veeloe]`, or `[bun, main.ts]` from source. */
  command: string[];
  proxyUrl: string;
  onMessage: (agent: string, message: FromWorker) => void;
  log?: (line: string) => void;
  backoff?: () => ReturnType<typeof createBackoff>;
}) {
  const running = new Map<string, Running>();
  const tokens = new Map<string, string>();
  const backoffs = new Map<string, ReturnType<typeof createBackoff>>();
  let stopping = false;

  function start(agent: Agent) {
    const dir = agentDir(home, agent.id);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const entry = { token, ready: false, waiting: [], startedAt: Date.now() } as unknown as Running;
    entry.process = Bun.spawn([...command, "worker", "--agent", agent.id], {
      cwd: join(dir, "workdir"),
      // Only what a worker needs. Never a Provider's key: the proxy holds that (ADR 0042).
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(dir, "tmp"), VEELOE_AGENT_DIR: dir, VEELOE_AGENT_NAME: agent.name, VEELOE_PROXY_URL: proxyUrl, VEELOE_PROXY_TOKEN: token },
      stdout: "inherit",
      stderr: "inherit",
      serialization: "json",
      ipc(message) {
        const m = message as FromWorker;
        if (m.kind === "ready") {
          entry.ready = true;
          for (const queued of entry.waiting.splice(0)) entry.process.send(queued);
        } else onMessage(agent.id, m);
      },
      onExit(_, code) {
        if (running.get(agent.id) !== entry) return;
        running.delete(agent.id);
        tokens.delete(token);
        for (const lost of entry.waiting) onMessage(agent.id, { kind: "error", member: lost.member, ref: lost.ref, code: "agent.unavailable", task: lost.task });
        if (stopping) return;
        const b = backoffs.get(agent.id) ?? backoff();
        backoffs.set(agent.id, b);
        if (Date.now() - entry.startedAt > HEALTHY_MS) b.reset();
        const delay = b.next();
        log(`worker of agent ${agent.id} ended (${code}); starting it again in ${delay} ms`);
        setTimeout(() => !stopping && !running.has(agent.id) && start(agent), delay);
      },
    });
    running.set(agent.id, entry);
    tokens.set(token, agent.id);
  }

  return {
    start,
    /** Which Agent a proxy token belongs to. */
    agentOfToken: (token: string) => tokens.get(token),
    /** False when the Agent has no worker right now, so the caller can say so. */
    send(agent: string, message: ToWorker): boolean {
      const entry = running.get(agent);
      if (!entry) return false;
      if (entry.ready) entry.process.send(message);
      else entry.waiting.push(message);
      return true;
    },
    pid: (agent: string) => running.get(agent)?.process.pid,
    stop() {
      stopping = true;
      for (const entry of running.values()) entry.process.kill();
      running.clear();
      tokens.clear();
    },
  };
}
