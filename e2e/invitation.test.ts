import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, parseMessage, parsePairingLink, publicKeyOf, toBase64url, type HubInvitationRequest, type KnownMessage } from "@veeloe/protocol-ts";
import type { Machine } from "../controller/src/entities/machine";
import { pairMachine } from "../controller/src/pages/add-machine/model/pair";
import { draftInvitation, letIn, openInvitation, takeRequest } from "../controller/src/pages/invite/model/invite";
import { askToJoin, ownCode } from "../controller/src/pages/join/model/join";
import { removeMember } from "../controller/src/pages/members/model/remove";
import { setTitle } from "../controller/src/pages/members/model/title";
import { startHubClient } from "../controller/src/shared/hub-client";
import { buildRuntime } from "../scripts/runtime";
import { FAKE_KEY, fakeProvider } from "./helpers/fake-provider";

// An Invitation end to end (ADR 0059, issue #99): the real Hub on Postgres, a Machine paired with the real
// `veeloe pair`, and both people running the app's own model code. It needs a migrated database: TEST_DB_DSN.
const dsn = process.env.TEST_DB_DSN;
if (!dsn && process.env.REQUIRE_TEST_DB === "true") throw new Error("TEST_DB_DSN is required when REQUIRE_TEST_DB=true");

const repo = `${import.meta.dir}/..`;
const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-invite-"));
const home = join(work, "machine");
const running: ReturnType<typeof Bun.spawn>[] = [];
const port = 19000 + Math.floor(Math.random() * 1000);
const hubUrl = `ws://127.0.0.1:${port}`;
const provider = fakeProvider();
let runtimeBinary = "";

beforeAll(async () => {
  if (!dsn) return;
  const built = Bun.spawnSync(["go", "build", "-o", join(work, "hub"), "./cmd/api"], { cwd: `${repo}/hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  runtimeBinary = buildRuntime();
  running.push(Bun.spawn([join(work, "hub")], { env: { ...process.env, PORT: String(port), DB_DSN: dsn, HUB_PUBLIC_URL: hubUrl, HUB_STUN_ADDR: "127.0.0.1:0", APP_ENV: "development" }, stdout: "ignore", stderr: "ignore" }));
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

async function lines(proc: ReturnType<typeof Bun.spawn>, until: string) {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let out = "";
  while (!out.includes(until)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(out);
    out += new TextDecoder().decode(value);
  }
  return out;
}

/** A Controller through the Hub, collecting what the Machine signed for it, and the invitation requests for it. */
function controller(secretKey: Uint8Array, machineKey: string) {
  const inbox: (KnownMessage & { task?: string })[] = [];
  const requests: HubInvitationRequest[] = [];
  const ready = Promise.withResolvers<string>();
  const client = startHubClient({
    hubUrl,
    secretKey,
    trustedKeys: new Set([machineKey]),
    onReady: (member) => ready.resolve(member),
    onInvitationRequest: (request) => requests.push(request),
    onEnvelope: ({ signed }) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, task: signed.task });
    },
  });
  const waitFor = async <T>(find: () => T | undefined, ms = 15_000): Promise<T> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = find();
      if (found !== undefined) return found;
      await Bun.sleep(20);
    }
    throw new Error(`nothing came; got ${inbox.map((m) => (m.type === "error" ? `error:${m.body.code}` : m.type)).join(", ")}`);
  };
  return { client, ready: ready.promise, inbox, requests, waitFor };
}

test.skipIf(!dsn)("an Owner invites someone with one link, compares their code, lets them in, and they work with the one Agent granted", async () => {
  // A Machine, paired, with a Provider, and its Owner.
  const pair = Bun.spawn([runtimeBinary, "pair", "--hub", hubUrl], { env: { VEELOE_HOME: home }, stdout: "pipe", stderr: "inherit" });
  running.push(pair);
  const out = await lines(pair, "Waiting up to");
  const parsed = parsePairingLink(out.slice(out.indexOf("veeloe://")).split("\n")[0]!, Date.now());
  if (!parsed.ok) throw new Error(parsed.reason);
  const ownerKey = generateSecretKey();
  const paired = await pairMachine({ link: parsed.link, secretKey: ownerKey, retryMs: 200, giveUpAt: Date.now() + 15_000 });
  if (!paired.ok) throw new Error(paired.code);
  await pair.exited;
  const add = Bun.spawn([runtimeBinary, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
  add.stdin.write(FAKE_KEY);
  await add.stdin.end();
  expect(await add.exited).toBe(0);
  const supervisor = Bun.spawn([runtimeBinary], { env: { VEELOE_HOME: home, PATH: process.env.PATH, HOME: process.env.HOME }, stdout: "pipe", stderr: "inherit" });
  running.push(supervisor);
  await lines(supervisor, "connected to hub");

  const m = paired.machine;
  const machine: Machine = { id: m.id, public_key: m.publicKey, name: m.name, hub_url: m.hubUrl, workspace_id: m.workspace, member_id: m.member, paired_at: Date.now(), egress: "[]" };
  const owner = controller(ownerKey, m.publicKey);
  await owner.ready;
  const toMachine = (type: string, body: unknown, task?: string) => owner.client.send({ type, to: m.id, member: m.member, ...(task ? { task } : {}), body });
  toMachine("agent.create", { id: "shared", name: "Shared", provider: "main", model: "model-a" });
  await owner.waitFor(() => owner.inbox.find((x) => x.type === "agent.listed" && x.body.agents.length === 1));
  toMachine("agent.create", { id: "private", name: "Private", provider: "main", model: "model-a" });
  await owner.waitFor(() => owner.inbox.find((x) => x.type === "agent.listed" && x.body.agents.length === 2));

  // The Owner opens a link for two people, with Use at one Agent.
  const authenticate = async (use: (key: Uint8Array) => Promise<void>) => {
    await use(ownerKey);
    return true;
  };
  const { link } = draftInvitation({ hub: hubUrl, ownKey: toBase64url(publicKeyOf(ownerKey)), from: "Pang", hours: 1 });
  expect(await openInvitation(authenticate, { link, max: 2, machine })).toEqual({ ok: true });

  // Someone opens it and asks in; the Owner hears the request, and its code matches the one they see.
  const kaiKey = generateSecretKey();
  const kai = askToJoin({ link, name: "Kai", secretKey: kaiKey, retryMs: 200 });
  const request = await owner.waitFor(() => owner.requests.at(-1));
  const ask = takeRequest(link, request, []);
  if (!ask) throw new Error("the request did not check out");
  expect(ask.code).toBe(ownCode(kaiKey));

  const result = await letIn(authenticate, { link, ask, machine, machines: [machine], grants: [{ machine: m.id, agent: "shared", level: "use" }], setGrant: (on, body) => toMachine("grant.set", body) !== null });
  if (!result?.answer.ok) throw new Error(JSON.stringify(result));
  await owner.waitFor(() => owner.inbox.find((x) => x.type === "grants.listed"));
  const joined = await kai.done;
  if (!joined.ok) throw new Error(joined.code);
  expect(joined.data).toMatchObject({ workspace: m.workspace, member: result.member, machines: [{ id: m.id, key: m.publicKey, hub: hubUrl }] });

  // The Machine took the new Member from the certificate, and their Grant.
  const trust = JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8"));
  expect(trust.members).toEqual([{ member: result.member, keys: [toBase64url(publicKeyOf(kaiKey))] }]);
  expect(trust.grants).toEqual([{ agent: "shared", member: result.member, level: "use" }]);

  // Kai connects with the new key, works with the Agent granted, and not with the other.
  const kaiApp = controller(kaiKey, m.publicKey);
  expect(await kaiApp.ready).toBe(result.member);
  const toMachineAsKai = (type: string, body: unknown, task?: string) => kaiApp.client.send({ type, to: m.id, member: result.member, ...(task ? { task } : {}), body });
  toMachineAsKai("task.message", { agent: "shared", id: "k1", text: "hi" }, "task-kai");
  await kaiApp.waitFor(() => kaiApp.inbox.find((x) => x.type === "task.event" && x.task === "task-kai" && x.body.kind === "turn.ended"));
  toMachineAsKai("task.message", { agent: "private", id: "k2", text: "hi" }, "task-kai-2");
  const refused = await kaiApp.waitFor(() => kaiApp.inbox.find((x) => x.type === "error"));
  expect(refused.type === "error" && refused.body.code).toBe("agent.forbidden");

  // A request the Hub made up, with no secret behind it, is never taken.
  expect(takeRequest(link, { ...request, key: toBase64url(publicKeyOf(generateSecretKey())) }, [])).toBeNull();

  const asKai = async (use: (key: Uint8Array) => Promise<void>) => {
    await use(kaiKey);
    return true;
  };
  // A title changes on the word of Kai themself or an Owner, as often as they like, and of no one else (#112).
  const titled = (who: typeof asKai, member: string, title: string) => setTitle(who, { hub: hubUrl, workspace: m.workspace, member, title });
  expect(await titled(asKai, result.member, "Sales")).toEqual({ ok: true });
  expect(await titled(authenticate, result.member, "Lead")).toEqual({ ok: true });
  expect(await titled(authenticate, result.member, "")).toEqual({ ok: true });
  expect(await titled(asKai, m.member, "Boss")).toMatchObject({ ok: false, code: "hub.member_title_invalid" });

  // Kai cannot take an Owner out; the Owner takes Kai out, and the Machine drops Kai's keys and Grants (#102).
  expect(await removeMember(asKai, { hub: hubUrl, workspace: m.workspace, member: m.member })).toMatchObject({ ok: false, code: "hub.member_remove_invalid" });
  expect(await removeMember(authenticate, { hub: hubUrl, workspace: m.workspace, member: result.member })).toEqual({ ok: true });
  const end = Date.now() + 15_000;
  let after = JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8"));
  while (after.members?.length && Date.now() < end) {
    await Bun.sleep(100);
    after = JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8"));
  }
  expect(after.members ?? []).toEqual([]);
  expect(after.grants ?? []).toEqual([]);
  owner.client.stop();
  kaiApp.client.stop();
}, 120_000);
