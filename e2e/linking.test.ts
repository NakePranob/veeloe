import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, parseMessage, parsePairingLink, publicKeyOf, signCertificate, toBase64url, type HubLinkRequest, type KnownMessage, type SignedPart } from "@veeloe/protocol";
import { pairMachine } from "../controller/src/pages/add-machine/model/pair";
import { approveLink, handOff, handoffData, openLink } from "../controller/src/pages/link-device/model/link";
import { readLink, sendLinkRequest, waitForHandoff } from "../controller/src/pages/link-this-device/model/wait";
import { postCertificate, startHubClient } from "../controller/src/shared/hub-client";
import { FAKE_KEY, fakeProvider } from "../packages/runtime/src/supervisor/providers/fake-provider";

// The real Hub on Postgres and the compiled `veeloe`, with the Controller's own code on both
// devices: Linking while the Machine is off, the new device at work, then a revocation while
// it is off again. It needs a migrated database: TEST_DB_DSN.
const dsn = process.env.TEST_DB_DSN;
if (!dsn && process.env.REQUIRE_TEST_DB === "true") throw new Error("TEST_DB_DSN is required when REQUIRE_TEST_DB=true");

const repo = `${import.meta.dir}/..`;
const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-link-"));
const running: ReturnType<typeof Bun.spawn>[] = [];
const port = 20000 + Math.floor(Math.random() * 1000);
const hubUrl = `ws://127.0.0.1:${port}`;
const veeloe = join(work, "veeloe");
const home = join(work, "machine");
const provider = fakeProvider();

beforeAll(async () => {
  if (!dsn) return;
  const built = Bun.spawnSync(["go", "build", "-o", join(work, "hub"), "./cmd/api"], { cwd: `${repo}/hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  const runtime = Bun.spawnSync(["bun", "build", `${repo}/packages/runtime/src/main.ts`, "--compile", "--outfile", veeloe], { stdout: "ignore", stderr: "inherit" });
  if (!runtime.success) throw new Error("could not build the Runtime");
  running.push(Bun.spawn([join(work, "hub")], { env: { ...process.env, PORT: String(port), DB_DSN: dsn, HUB_PUBLIC_URL: hubUrl, APP_ENV: "development" }, stdout: "ignore", stderr: "ignore" }));
  const end = Date.now() + 15_000;
  while (!(await fetch(`http://127.0.0.1:${port}/readyz`).then((r) => r.ok, () => false))) {
    if (Date.now() > end) throw new Error("the Hub did not come up");
    await Bun.sleep(100);
  }
}, 180_000);

afterAll(() => {
  running.forEach((p) => p.kill());
  provider.server.stop(true);
  rmSync(work, { recursive: true, force: true });
});

async function readUntil(proc: Bun.Subprocess<"ignore", "pipe", "inherit">, text: string) {
  const reader = proc.stdout.getReader();
  let out = "";
  while (!out.includes(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`ended before "${text}": ${out}`);
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return out;
}

/** `veeloe`, connected to the Hub. */
async function startMachine() {
  const proc = Bun.spawn([veeloe], { env: { VEELOE_HOME: home, PATH: process.env.PATH, HOME: process.env.HOME }, stdout: "pipe", stderr: "inherit" });
  running.push(proc);
  await readUntil(proc, "connected to hub");
  return proc;
}

async function stopMachine(proc: Bun.Subprocess) {
  proc.kill();
  await proc.exited;
}

const trust = () => JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8")) as { owners: { member: string; keys: string[] }[]; revoked: string[] };

async function until(cond: () => boolean, what: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

/** A Controller as the app runs one: its own client, reading what its Machine signs. */
function controller(secretKey: Uint8Array, machineKey: string) {
  const inbox: (KnownMessage & { task?: string })[] = [];
  const state = { ready: false, revoked: false };
  const requests: HubLinkRequest[] = [];
  // Other devices of this Member it waits to hear from, as the app's links do.
  const watchers = new Map<string, (signed: SignedPart) => void>();
  const client = startHubClient({
    hubUrl,
    secretKey,
    trustedKeys: { has: (key) => key === machineKey || watchers.has(key) },
    onReady: () => (state.ready = true),
    onRevoked: () => (state.revoked = true),
    onLinkRequest: (request) => void requests.push(request),
    onEnvelope: ({ from, signed }) => {
      if (from !== machineKey) return watchers.get(from)?.(signed);
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, task: signed.task });
    },
  });
  running.push({ kill: () => client.stop() } as never);
  const watch = (key: string, handler: (signed: SignedPart) => void) => {
    watchers.set(key, handler);
    return () => void watchers.delete(key);
  };
  return { client, inbox, state, watch, requests };
}

test.skipIf(!dsn)("a linked browser commands the Machine its phone paired, sees the phone's Tasks, and is shut out once revoked", async () => {
  // The phone pairs the Machine, which gets a Provider.
  const pair = Bun.spawn([veeloe, "pair", "--hub", hubUrl], { env: { VEELOE_HOME: home }, stdout: "pipe", stderr: "inherit" });
  running.push(pair);
  const shown = await readUntil(pair, "Waiting up to");
  const parsedPair = parsePairingLink(shown.slice(shown.indexOf("veeloe://")).split("\n")[0]!, Date.now());
  if (!parsedPair.ok) throw new Error(parsedPair.reason);
  const phone = generateSecretKey();
  const paired = await pairMachine({ link: parsedPair.link, secretKey: phone, retryMs: 200, giveUpAt: Date.now() + 15_000 });
  if (!paired.ok) throw new Error(paired.code);
  expect(await pair.exited).toBe(0);
  const add = Bun.spawn([veeloe, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: new Blob([FAKE_KEY]), stdout: "pipe" });
  expect(await add.exited).toBe(0);
  const { id: machineId, publicKey: machineKey, workspace, member } = paired.machine;
  const machineRow = { id: machineId, public_key: machineKey, name: paired.machine.name, hub_url: hubUrl, workspace_id: workspace, member_id: member, paired_at: 1, egress: "[]" };

  // The phone starts a Task while the Machine is up.
  let machine = await startMachine();
  const onPhone = controller(phone, machineKey);
  await until(() => onPhone.state.ready, "the phone to connect");
  const toMachine = (c: ReturnType<typeof controller>, type: string, body: unknown, task?: string) => c.client.send({ type, to: machineId, member, ...(task ? { task } : {}), body });
  toMachine(onPhone, "agent.create", { id: "agent-link", name: "Deployer", provider: "main", model: "model-a" });
  await until(() => onPhone.inbox.some((m) => m.type === "agent.listed" && m.body.agents.length === 1), "the Agent");
  toMachine(onPhone, "task.message", { agent: "agent-link", id: "m-phone", text: "สวัสดี" }, "task-phone");
  await until(() => onPhone.inbox.some((m) => m.type === "task.event" && m.body.kind === "turn.ended"), "the phone's Turn");

  // The Machine is off while the browser is linked.
  await stopMachine(machine);
  const browser = generateSecretKey();
  const browserKey = toBase64url(publicKeyOf(browser));
  const phoneKey = toBase64url(publicKeyOf(phone));
  // The phone shows the QR, with its Hub in it; the browser reads it and never asks for a Hub.
  const offer = openLink({ hub: hubUrl, ownKey: phoneKey });
  const read = readLink(offer.text);
  if (!read.ok) throw new Error(read.code);
  expect(read.link.hub).toBe(hubUrl);
  const waiting = waitForHandoff({ link: read.link, secretKey: browser });
  expect(await sendLinkRequest({ link: read.link, name: "Chrome", secretKey: browser })).toEqual({ ok: true });
  await until(() => onPhone.requests.length === 1, "the phone to get the request");
  const ask = offer.take(onPhone.requests[0]!);
  expect(ask).toEqual({ key: browserKey, name: "Chrome" });

  // Someone else with the link gets a request to the phone, which reads it as nothing: it works once.
  expect(await sendLinkRequest({ link: read.link, name: "Chrome", secretKey: generateSecretKey() })).toEqual({ ok: true });
  await until(() => onPhone.requests.length === 2, "the second request");
  expect(offer.take(onPhone.requests[1]!)).toBeNull();
  // A request for a device that is not connected goes nowhere.
  expect(await sendLinkRequest({ link: { ...read.link, to: toBase64url(publicKeyOf(generateSecretKey())) }, name: "Chrome", secretKey: browser })).toEqual({ ok: false, code: "hub.device_offline" });

  // Until the owner approves, the Hub still does not know the browser's key.
  const early = controller(browser, machineKey);
  await Bun.sleep(600);
  expect(early.state.ready).toBe(false);
  early.client.stop();

  const approved = await approveLink(async (use) => (await use(phone), true), { link: offer.link, ask: ask!, name: "Chrome", machine: machineRow });
  expect(approved).toEqual({ ok: true });
  const devices = [{ key: phoneKey, member_id: member, name: "iPhone", linked_by: null, linked_at: null, revoked_at: null }];
  const linked = handOff({
    link: offer.link,
    key: ask!.key,
    data: handoffData(hubUrl, [machineRow], devices),
    retryMs: 300,
    send: (type, body) => onPhone.client.send({ type, recipients: [member], body }),
    watch: onPhone.watch,
  });
  const received = await waiting.done;
  expect(received).toMatchObject({ ok: true, data: { workspace, member, machines: [{ id: machineId, key: machineKey }], keys: [{ key: phoneKey, name: "iPhone" }] } });
  expect(await linked).toBe("linked");

  // Back on, the Machine takes the certificate before anything else, and the browser is heard.
  machine = await startMachine();
  const onBrowser = controller(browser, machineKey);
  await until(() => onBrowser.state.ready, "the browser to connect");
  await until(() => trust().owners[0]!.keys.includes(browserKey), "the Machine to trust the browser");
  toMachine(onBrowser, "task.list", {});
  const listed = await (async () => {
    await until(() => onBrowser.inbox.some((m) => m.type === "task.listed"), "task.listed");
    return onBrowser.inbox.find((m) => m.type === "task.listed")!;
  })();
  expect(listed.type === "task.listed" && listed.body.tasks.map((t) => [t.id, t.agent])).toEqual([["task-phone", "agent-link"]]);
  toMachine(onBrowser, "task.message", { agent: "agent-link", id: "m-browser", text: "อีกข้อ" }, "task-phone");
  await until(() => onBrowser.inbox.some((m) => m.type === "task.event" && m.body.kind === "turn.ended"), "the browser's Turn");

  // Revoking the phone would take the browser it linked too, leaving nobody: the Hub refuses.
  const lastOne = await postCertificate(hubUrl, "/revocations", signCertificate({ type: "device.revoke", workspace, member, key: phoneKey, keep: [], at: Date.now() }, phone));
  expect(lastOne).toEqual({ ok: false, code: "hub.last_device" });

  // Revoked from the phone while the Machine is off: the browser is cut off at once.
  await stopMachine(machine);
  expect(await postCertificate(hubUrl, "/revocations", signCertificate({ type: "device.revoke", workspace, member, key: browserKey, keep: [], at: Date.now() }, phone))).toEqual({ ok: true });
  await until(() => onBrowser.state.revoked, "the browser to hear 4403");

  // Back on, the Machine drops the key before any envelope, and keeps it dropped.
  machine = await startMachine();
  await until(() => trust().revoked.includes(browserKey) && !trust().owners[0]!.keys.includes(browserKey), "the Machine to revoke the browser");
  const again = controller(browser, machineKey);
  await until(() => again.state.revoked, "the revoked key to be refused at the Hub");
  expect(again.state.ready).toBe(false);
  // The phone still commands the Machine.
  onPhone.inbox.length = 0;
  await until(() => onPhone.state.ready, "the phone");
  toMachine(onPhone, "agent.list", {});
  await until(() => onPhone.inbox.some((m) => m.type === "agent.listed"), "the phone to still be heard");
  await stopMachine(machine);
}, 120_000);
