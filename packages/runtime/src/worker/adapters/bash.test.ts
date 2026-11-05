import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool, OUTPUT_LIMIT } from "./bash";

// Outside any sandbox: these are the tool's own rules. e2e runs it inside one.
const workdir = realpathSync(mkdtempSync(join(tmpdir(), "veeloe-bash-")));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "json" };
// One "second" is 20 ms here, so the 120 s default is 2.4 s and the 600 s ceiling 12 s.
const tool = bashTool({ workdir, env, secondMs: 20 });
const bash = (command: string, timeout?: number) => tool.run("bash", { command, ...(timeout === undefined ? {} : { timeout }) });
const failure = (promise: Promise<string>) => promise.then(() => { throw new Error("expected the command to fail"); }, (err: Error) => err.message);

test("a command starts in the Workdir every time, and cd does not carry over", async () => {
  expect(await bash("pwd")).toBe(`${workdir}\nexit code: 0`);
  expect(await bash("cd /tmp && export X=1 && pwd")).toMatch(/\/tmp\nexit code: 0$/);
  expect(await bash('pwd; echo "x=$X"')).toBe(`${workdir}\nx=\nexit code: 0`);
});

test("a command that reads stdin gets nothing and ends", async () => {
  expect(await bash("cat; echo after")).toBe("after\nexit code: 0");
});

test("stdout and stderr come back in the order they were written", async () => {
  expect(await bash("echo one; echo two >&2; echo three; echo four >&2")).toBe("one\ntwo\nthree\nfour\nexit code: 0");
});

test("a command that ends with an exit code other than 0 is an error the LLM reads with its output", async () => {
  expect(await failure(bash("echo 'no such thing' >&2; exit 3"))).toBe("no such thing\nexit code: 3");
});

test("output past the limit keeps its end and says how much was cut", async () => {
  const out = await bash(`head -c ${OUTPUT_LIMIT + 5000} /dev/zero | tr '\\0' a; echo END`);
  expect(out).toStartWith("[the first 5004 characters were cut]\n");
  expect(out).toEndWith("END\nexit code: 0");
  expect(out.length).toBeLessThan(OUTPUT_LIMIT + 100);
});

test("a command past its time is stopped with everything it started, and what it printed comes back", async () => {
  const marker = `veeloe-test-${process.pid}-${Date.now()}`;
  const started = Date.now();
  const message = await failure(bash(`echo started; (exec -a ${marker} sleep 300) & exec -a ${marker} sleep 300`, 5));
  expect(Date.now() - started).toBeLessThan(2000);
  expect(message).toBe("started\ntimed out after 5 seconds, so it was stopped");
  await Bun.sleep(100);
  expect(Bun.spawnSync(["pgrep", "-f", marker]).stdout.toString()).toBe("");
});

test("a timeout without a number is 120 seconds, and none is longer than 600", async () => {
  expect(await failure(bash("sleep 300"))).toBe("timed out after 120 seconds, so it was stopped");
  const started = Date.now();
  expect(await failure(bash("sleep 300", 3600))).toBe("timed out after 600 seconds, so it was stopped");
  expect(Date.now() - started).toBeLessThan(14_000);
}, 30_000);

test("what a command left running in the background does not outlive it", async () => {
  const marker = `veeloe-bg-${process.pid}-${Date.now()}`;
  expect(await bash(`(exec -a ${marker} sleep 300) & echo left`)).toBe("left\nexit code: 0");
  await Bun.sleep(100);
  expect(Bun.spawnSync(["pgrep", "-f", marker]).stdout.toString()).toBe("");
});

test("a command does not get the variables the worker reaches the supervisor by", async () => {
  expect(await bash("env | grep -c NODE_CHANNEL || true")).toBe("0\nexit code: 0");
});
