import { afterAll, afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, publicKeyOf, toBase64url } from "@veeloe/protocol";
import { startSupervisor } from ".";
import { fakeHub } from "./hub-link/fake-hub";
import { saveTrust } from "./trust/store";

const work = mkdtempSync(join(tmpdir(), "veeloe-binary-"));
const binary = join(work, "veeloe");
await $`bun build ${import.meta.dir}/../main.ts --compile --outfile ${binary}`.quiet();
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("the built binary creates its key and connects to a Hub", async () => {
  const hub = fakeHub();
  const proc = Bun.spawn([binary], { env: { VEELOE_HOME: join(work, "home"), VEELOE_HUB_URL: hub.url }, stdout: "pipe" });
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
  } finally {
    proc.kill();
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
  expect(existsSync(join(home, "trust.json"))).toBe(true);

  const eof = Bun.spawn([binary, "unpair"], { env: { VEELOE_HOME: home }, stdin: new Blob([]), stdout: "pipe" });
  expect(await eof.exited).toBe(1);
  expect(existsSync(join(home, "trust.json"))).toBe(true);

  const yes = Bun.spawn([binary, "unpair"], { env: { VEELOE_HOME: home }, stdin: new Blob(["y\n"]), stdout: "pipe" });
  expect(await yes.exited).toBe(0);
  expect(existsSync(join(home, "trust.json"))).toBe(false);
});

// TEST-ONLY KEYS.
const machineSeed = new Uint8Array(32).fill(0x33);
const ownerSeed = new Uint8Array(32).fill(0x44);
const strangerSeed = new Uint8Array(32).fill(0x22);
const envelope = (seed: Uint8Array, seq: number) => createSigner(seed, () => seq)({ type: "task.message", to: "machine-1", body: {} });

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((f) => f()));

async function supervisedHome(home = mkdtempSync(join(tmpdir(), "veeloe-sup-")), hub = fakeHub()) {
  saveTrust(home, { owners: [{ member: "m_1", keys: [toBase64url(publicKeyOf(ownerSeed))] }] });
  const lines: string[] = [];
  const running = startSupervisor({ home, hubUrl: hub.url, secretKey: machineSeed, log: (l) => lines.push(l) });
  stops.push(() => running.stop(), () => hub.server.stop(true));
  const start = Date.now();
  while (!lines.some((l) => l.includes("connected to hub"))) {
    if (Date.now() - start > 2000) throw new Error("did not connect");
    await Bun.sleep(5);
  }
  const heard = async (text: string) => {
    const from = Date.now();
    while (!lines.some((l) => l.includes(text))) {
      if (Date.now() - from > 2000) throw new Error(`never heard ${text}: ${lines.join("; ")}`);
      await Bun.sleep(5);
    }
  };
  return { home, hub, lines, heard, running };
}

test("an envelope from a key the Machine does not trust is dropped", async () => {
  const { hub, heard, lines } = await supervisedHome();
  hub.send(envelope(strangerSeed, 1));
  await heard("dropped an envelope: untrusted-key");
  expect(lines.some((l) => l.startsWith("accepted"))).toBe(false);
  hub.send(envelope(ownerSeed, 1));
  await heard("accepted task.message");
});

test("an old envelope sent again after a restart is dropped", async () => {
  const first = await supervisedHome();
  first.hub.send(envelope(ownerSeed, 5));
  await first.heard("accepted task.message");
  first.running.stop();
  first.hub.server.stop(true);

  const second = await supervisedHome(first.home);
  second.hub.send(envelope(ownerSeed, 5));
  await second.heard("dropped an envelope: replayed");
  second.hub.send(envelope(ownerSeed, 6));
  await second.heard("accepted task.message");
});
