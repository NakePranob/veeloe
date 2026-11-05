import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policyFor, type Policy } from "../sandbox/sandbox";
import { createWorkers } from "./workers";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

function setup(wrap: (argv: string[], policy: Policy) => Promise<string[]>) {
  const home = mkdtempSync(join(tmpdir(), "veeloe-workers-"));
  // A stand-in worker that writes down what it was started with.
  const command = ["/bin/sh", "-c", 'env > "$VEELOE_AGENT_DIR/env.txt"; echo "$@" > "$VEELOE_AGENT_DIR/args.txt"; exec sleep 30', "sh"];
  const lines: string[] = [];
  const workers = createWorkers({ home, command, wrap, llm: async () => ({ status: 200, headers: {}, body: "" }), onMessage: () => {}, log: (l) => lines.push(l) });
  cleanup.push(() => {
    workers.stop();
    rmSync(home, { recursive: true, force: true });
  });
  return { home, workers, lines };
}

test("every worker starts through the sandbox with its own Agent's rules, and its environment holds no way to the LLM but IPC", async () => {
  const wrapped: { argv: string[]; policy: Policy }[] = [];
  const { home, workers } = setup(async (argv, policy) => {
    wrapped.push({ argv, policy });
    return argv;
  });
  workers.start({ id: "a1", name: "A", provider: "p", model: "m" });
  await until(() => existsSync(join(home, "agents/a1/args.txt")));

  expect(wrapped).toHaveLength(1);
  expect(wrapped[0]!.argv.slice(-3)).toEqual(["worker", "--agent", "a1"]);
  expect(wrapped[0]!.policy).toEqual(policyFor(home, "a1", process.env.HOME!));
  await until(() => readFileSync(join(home, "agents/a1/env.txt"), "utf8").includes("VEELOE_AGENT_NAME"));
  const env = readFileSync(join(home, "agents/a1/env.txt"), "utf8");
  expect(env).not.toContain("VEELOE_PROXY");
  expect(env).toContain(`TMPDIR=${join(home, "agents/a1/tmp")}`);
  expect(env).toContain(`CLAUDE_CODE_TMPDIR=${join(home, "agents/a1/tmp")}`);
});

test("a worker the sandbox cannot wrap is never started outside it, and is tried again later", async () => {
  let tries = 0;
  const { home, workers, lines } = setup(async () => {
    tries++;
    throw new Error("no sandbox here");
  });
  workers.start({ id: "a1", name: "A", provider: "p", model: "m" });
  await until(() => lines.some((l) => l.includes("could not sandbox it: no sandbox here")));
  expect(workers.send("a1", { kind: "sync", task: "t", after: 0, member: "m", ref: "r" })).toBe(false);
  expect(existsSync(join(home, "agents/a1/env.txt"))).toBe(false);
  await until(() => tries >= 2, 3000);
});
