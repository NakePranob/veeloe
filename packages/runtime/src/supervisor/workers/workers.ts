import { join } from "node:path";
import { createBackoff, type Agent } from "@veeloe/protocol";
import type { FromWorker, LlmRequest, LlmResponse, ToWorker } from "../../ipc";
import { agentDir } from "../agent-registry/registry";
import { policyFor, type Sandbox } from "../sandbox/sandbox";

type Running = { process?: ReturnType<typeof Bun.spawn>; ready: boolean; waiting: ToWorker[]; startedAt: number };

// A worker that lived this long counts as having started fine, so its next crash waits the shortest time again.
const HEALTHY_MS = 60_000;

export type Workers = ReturnType<typeof createWorkers>;

/**
 * One worker process per Agent (ADR 0020), started from the same binary inside
 * the sandbox with that Agent's own rules (ADR 0008), every time it starts. A
 * worker that ends without being told is started again, later each time.
 * Messages wait for a worker that is starting, and come back as
 * `agent.unavailable` if it dies before it reads them. Its LLM requests come
 * over its own IPC, so which Agent sent one is never in question (ADR 0042).
 */
export function createWorkers({
  home,
  command,
  wrap,
  llm,
  onMessage,
  log = console.log,
  backoff = () => createBackoff({ capMs: 30_000 }),
}: {
  home: string;
  /** How to run this binary: `[veeloe]`, or `[bun, main.ts]` from source. */
  command: string[];
  wrap: Sandbox["wrap"];
  llm: (agent: string, request: LlmRequest) => Promise<LlmResponse>;
  onMessage: (agent: string, message: Exclude<FromWorker, { kind: "ready" | "llm.request" }>) => void;
  log?: (line: string) => void;
  backoff?: () => ReturnType<typeof createBackoff>;
}) {
  const running = new Map<string, Running>();
  const backoffs = new Map<string, ReturnType<typeof createBackoff>>();
  let stopping = false;

  function ended(agent: Agent, entry: Running, why: string) {
    if (running.get(agent.id) !== entry) return;
    running.delete(agent.id);
    for (const lost of entry.waiting) if (lost.kind !== "llm.response") onMessage(agent.id, { kind: "error", member: lost.member, ref: lost.ref, code: "agent.unavailable", task: lost.task });
    if (stopping) return;
    const b = backoffs.get(agent.id) ?? backoff();
    backoffs.set(agent.id, b);
    if (Date.now() - entry.startedAt > HEALTHY_MS) b.reset();
    const delay = b.next();
    log(`worker of agent ${agent.id} ended (${why}); starting it again in ${delay} ms`);
    setTimeout(() => !stopping && !running.has(agent.id) && start(agent), delay);
  }

  async function spawn(agent: Agent, entry: Running) {
    const dir = agentDir(home, agent.id);
    const argv = await wrap([...command, "worker", "--agent", agent.id], policyFor(home, agent.id, process.env.HOME ?? "/nonexistent"));
    if (running.get(agent.id) !== entry) return; // stopped while wrapping
    const tmp = join(dir, "tmp");
    entry.process = Bun.spawn(argv, {
      cwd: join(dir, "workdir"),
      // Only what a worker needs. Never a Provider's key: the supervisor holds that (ADR 0042).
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, VEELOE_AGENT_DIR: dir, VEELOE_AGENT_NAME: agent.name },
      stdout: "inherit",
      stderr: "inherit",
      serialization: "json",
      ipc(message) {
        const m = message as FromWorker;
        if (m.kind === "ready") {
          entry.ready = true;
          for (const queued of entry.waiting.splice(0)) entry.process!.send(queued);
        } else if (m.kind === "llm.request") {
          const { id, kind: _, ...request } = m;
          void llm(agent.id, request).then((answer) => running.get(agent.id) === entry && entry.process!.send({ kind: "llm.response", id, ...answer } satisfies ToWorker));
        } else onMessage(agent.id, m);
      },
      onExit(_, code) {
        ended(agent, entry, String(code));
      },
    });
  }

  function start(agent: Agent) {
    const entry: Running = { ready: false, waiting: [], startedAt: Date.now() };
    running.set(agent.id, entry);
    spawn(agent, entry).catch((err: Error) => ended(agent, entry, `could not sandbox it: ${err.message}`));
  }

  return {
    start,
    /** False when the Agent has no worker right now, so the caller can say so. */
    send(agent: string, message: ToWorker): boolean {
      const entry = running.get(agent);
      if (!entry) return false;
      if (entry.ready) entry.process!.send(message);
      else entry.waiting.push(message);
      return true;
    },
    pid: (agent: string) => running.get(agent)?.process?.pid,
    stop() {
      stopping = true;
      for (const entry of running.values()) entry.process?.kill();
      running.clear();
    },
  };
}
