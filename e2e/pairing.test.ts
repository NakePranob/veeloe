import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, parsePairingLink, publicKeyOf, toBase64url } from "@veeloe/protocol";
import { pairMachine } from "../controller/src/pages/add-machine/model/pair";

// The real Hub on Postgres and the real `veeloe pair`, with the Controller's own
// code on the other side. It needs a migrated database: TEST_DB_DSN.
const dsn = process.env.TEST_DB_DSN;
if (!dsn && process.env.REQUIRE_TEST_DB === "true") throw new Error("TEST_DB_DSN is required when REQUIRE_TEST_DB=true");

const repo = `${import.meta.dir}/..`;
const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-"));
const running: ReturnType<typeof Bun.spawn>[] = [];
const port = 19000 + Math.floor(Math.random() * 1000);
const hubUrl = `ws://127.0.0.1:${port}`;
const veeloe = join(work, "veeloe");

beforeAll(async () => {
  if (!dsn) return;
  const built = Bun.spawnSync(["go", "build", "-o", join(work, "hub"), "./cmd/api"], { cwd: `${repo}/hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  const runtime = Bun.spawnSync(["bun", "build", `${repo}/packages/runtime/src/main.ts`, "--compile", "--outfile", veeloe], { stdout: "ignore", stderr: "inherit" });
  if (!runtime.success) throw new Error("could not build the Runtime");
  running.push(Bun.spawn([join(work, "hub")], { env: { ...process.env, PORT: String(port), DB_DSN: dsn, HUB_PUBLIC_URL: hubUrl, APP_ENV: "development" }, stdout: "ignore", stderr: "ignore" }));
  const end = Date.now() + 15_000;
  while (true) {
    const up = await fetch(`http://127.0.0.1:${port}/readyz`).then((r) => r.ok, () => false);
    if (up) break;
    if (Date.now() > end) throw new Error("the Hub did not come up");
    await Bun.sleep(100);
  }
}, 180_000);

afterAll(() => {
  running.forEach((p) => p.kill());
  rmSync(work, { recursive: true, force: true });
});

async function startPair(home: string) {
  const proc = Bun.spawn([veeloe, "pair", "--hub", hubUrl], { env: { VEELOE_HOME: home }, stdout: "pipe", stderr: "inherit" });
  running.push(proc);
  const reader = proc.stdout.getReader();
  let out = "";
  while (!out.includes("Waiting up to")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`veeloe pair ended: ${out}`);
    out += new TextDecoder().decode(value);
  }
  const text = out.slice(out.indexOf("veeloe://")).split("\n")[0]!;
  const parsed = parsePairingLink(text, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  return { proc, link: parsed.link };
}

test.skipIf(!dsn)("a Machine and a Controller pair through the real Hub, and the Machine trusts the right key", async () => {
  const home = join(work, "machine");
  const { proc, link } = await startPair(home);
  const secretKey = generateSecretKey();

  const result = await pairMachine({ link, secretKey, retryMs: 200, giveUpAt: Date.now() + 15_000 });
  if (!result.ok) throw new Error(result.code);
  expect(await proc.exited).toBe(0);
  expect(result.machine.publicKey).toBe(link.machine);

  const trust = JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8"));
  expect(trust).toEqual({ owners: [{ member: result.machine.member, keys: [toBase64url(publicKeyOf(secretKey))] }], workspace: result.machine.workspace, links: [], revoked: [] });
  expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8"))).toEqual({ hubUrl });

  // The Hub now accepts the Machine for good: plain `veeloe` reconnects with what pair saved.
  const supervisor = Bun.spawn([veeloe], { env: { VEELOE_HOME: home, PATH: process.env.PATH, HOME: process.env.HOME }, stdout: "pipe", stderr: "inherit" });
  running.push(supervisor);
  const reader = supervisor.stdout.getReader();
  let out = "";
  while (!out.includes("connected to hub")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(out);
    out += new TextDecoder().decode(value);
  }
  expect(out).toContain(`as machine ${result.machine.id}`);
  supervisor.kill();

  // A second Machine lands in the same Workspace, and a stranger cannot take one.
  const second = await startPair(join(work, "machine-2"));
  const again = await pairMachine({ link: second.link, secretKey, retryMs: 200, giveUpAt: Date.now() + 15_000 });
  if (!again.ok) throw new Error(again.code);
  expect(again.machine.workspace).toBe(result.machine.workspace);
  expect(again.machine.member).toBe(result.machine.member);

  expect(await pairMachine({ link, secretKey: generateSecretKey(), retryMs: 200, giveUpAt: Date.now() + 2_000 })).toEqual({ ok: false, code: "hub.machine_taken" });
}, 60_000);
