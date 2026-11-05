import { afterAll, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHub } from "./hub-link/fake-hub";
import { saveTrust } from "./trust/store";

const work = mkdtempSync(join(tmpdir(), "veeloe-binary-"));
const binary = join(work, "veeloe");
await $`bun build ${import.meta.dir}/../main.ts --compile --outfile ${binary}`.quiet();
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("the built binary creates its key and connects to a Hub", async () => {
  const hub = fakeHub();
  saveTrust(join(work, "home"), { owners: [{ member: "m", keys: ["k"] }] });
  const proc = Bun.spawn([binary], { env: { PATH: process.env.PATH, HOME: process.env.HOME, VEELOE_HOME: join(work, "home"), VEELOE_HUB_URL: hub.url }, stdout: "pipe" });
  try {
    let out = "";
    const reader = proc.stdout.getReader();
    while (!out.includes("connected to hub")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toMatch(/machine key [A-Za-z0-9_-]{43}\n/);
    expect(out).toContain(`connected to hub ${hub.url} as machine machine-1`);
    // It ends when told to, sandbox and all: sandbox-runtime's own signal handlers would keep it running.
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  } finally {
    proc.kill("SIGKILL");
    hub.server.stop(true);
  }
});

test("the built binary exits with an error naming both settings when no Hub URL is set", async () => {
  const proc = Bun.spawn([binary], { env: { VEELOE_HOME: join(work, "empty") }, stderr: "pipe" });
  expect(await proc.exited).toBe(1);
  expect(await new Response(proc.stderr).text()).toMatch(/hubUrl.*VEELOE_HUB_URL/);
});

test("the built binary refuses a bad Hub URL for pair, and needs a yes to unpair", async () => {
  const home = join(work, "commands");
  const pair = Bun.spawn([binary, "pair", "--hub", "https://not-a-hub.example.com"], { env: { VEELOE_HOME: home }, stderr: "pipe" });
  expect(await pair.exited).toBe(1);
  expect(await new Response(pair.stderr).text()).toContain("ws://");

  const none = Bun.spawn([binary, "pair"], { env: { VEELOE_HOME: home }, stderr: "pipe" });
  expect(await none.exited).toBe(1);
  expect(await new Response(none.stderr).text()).toContain("veeloe pair --hub");

  saveTrust(home, { owners: [] });
  const no = Bun.spawn([binary, "unpair"], { env: { VEELOE_HOME: home }, stdin: new Blob(["n\n"]), stdout: "pipe" });
  expect(await no.exited).toBe(1);
  expect(existsSync(join(home, "runtime/trust.json"))).toBe(true);

  const eof = Bun.spawn([binary, "unpair"], { env: { VEELOE_HOME: home }, stdin: new Blob([]), stdout: "pipe" });
  expect(await eof.exited).toBe(1);
  expect(existsSync(join(home, "runtime/trust.json"))).toBe(true);

  const yes = Bun.spawn([binary, "unpair"], { env: { VEELOE_HOME: home }, stdin: new Blob(["y\n"]), stdout: "pipe" });
  expect(await yes.exited).toBe(0);
  expect(existsSync(join(home, "runtime/trust.json"))).toBe(false);
});

test("without a terminal the built binary never waits on a question: an unpaired Machine gets the steps, a missing flag is named", async () => {
  const home = join(work, "no-terminal");
  const start = Bun.spawn([binary], { env: { VEELOE_HOME: home, VEELOE_HUB_URL: "ws://127.0.0.1:1" }, stdin: "ignore", stderr: "pipe" });
  expect(await start.exited).toBe(1);
  expect(await new Response(start.stderr).text()).toContain("not paired yet. From a terminal, run:\n  veeloe pair");

  const add = Bun.spawn([binary, "provider", "add"], { env: { VEELOE_HOME: home }, stdin: "ignore", stderr: "pipe" });
  expect(await add.exited).toBe(1);
  expect(await new Response(add.stderr).text()).toContain("missing --name");
});

test("the built binary refuses a key given as an argument and never prints it", async () => {
  for (const args of [["provider", "add", "--preset", "anthropic", "--key", "sk-secret"], ["provider", "add", "--key=sk-secret"], ["provider", "add", "sk-secret"]]) {
    const proc = Bun.spawn([binary, ...args], { env: { VEELOE_HOME: join(work, "key-arg") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(2);
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    expect(out).toContain("never an argument");
    expect(out).not.toContain("sk-secret");
  }
});

test("help is there for every command, and an unknown one points to it", async () => {
  for (const args of [["--help"], ["help", "provider"], ["status", "--help"]]) {
    const proc = Bun.spawn([binary, ...args], { stdout: "pipe" });
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stdout).text()).toContain("veeloe");
  }
  const unknown = Bun.spawn([binary, "frobnicate"], { stderr: "pipe" });
  expect(await unknown.exited).toBe(2);
  expect(await new Response(unknown.stderr).text()).toContain("run veeloe --help");
});
