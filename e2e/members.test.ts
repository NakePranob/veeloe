import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, publicKeyOf, toBase64url, type KnownMessage } from "@veeloe/protocol-ts";
import { startHubClient } from "../controller/src/shared/hub-client";
import { buildRuntime } from "../scripts/runtime";
import { bashUseSse, FAKE_KEY, fakeProvider, sse } from "./helpers/fake-provider";

// The compiled `veeloe` through the real relay, with an Owner and a second Member who is not one
// (ADR 0010, issue #98). TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const ownerSeed = new Uint8Array(32).fill(0x44);
const colleagueSeed = new Uint8Array(32).fill(0x66);
const machineKey = toBase64url(publicKeyOf(machineSeed));

const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-members-"));
const home = join(work, "home");
const running: ReturnType<typeof Bun.spawn>[] = [];
const provider = fakeProvider();
let url: string;

beforeAll(async () => {
  const hubBinary = join(work, "testhub");
  const built = Bun.spawnSync(["go", "build", "-o", hubBinary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!built.success) throw new Error("could not build the Hub");
  const runtimeBinary = buildRuntime();
  const hub = Bun.spawn([hubBinary], { stdout: "pipe", stderr: "inherit" });
  running.push(hub);
  const { value } = await (hub.stdout as ReadableStream<Uint8Array>).getReader().read();
  url = new TextDecoder().decode(value).trim();

  // What pairing and an Invitation (#99) would have left: an Owner, and a Member with no Grant yet.
  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "machine.key"), machineSeed, { mode: 0o600 });
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: url }), { mode: 0o600 });
  const trust = {
    owners: [{ member: "member-1", keys: [toBase64url(publicKeyOf(ownerSeed))] }],
    members: [{ member: "member-2", keys: [toBase64url(publicKeyOf(colleagueSeed))] }],
  };
  writeFileSync(join(home, "runtime/trust.json"), JSON.stringify(trust), { mode: 0o600 });
  chmodSync(home, 0o700);

  const add = Bun.spawn([runtimeBinary, "provider", "add", "--name", "main", "--url", provider.url], { env: { VEELOE_HOME: home }, stdin: "pipe", stdout: "pipe" });
  add.stdin.write(FAKE_KEY);
  await add.stdin.end();
  if ((await add.exited) !== 0) throw new Error(await new Response(add.stdout).text());

  const supervisor = Bun.spawn([runtimeBinary], { env: { VEELOE_HOME: home, PATH: process.env.PATH }, stdout: "pipe", stderr: "inherit" });
  running.push(supervisor);
  const reader = supervisor.stdout.getReader();
  let out = "";
  while (!out.includes("connected to hub")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(out);
    out += new TextDecoder().decode(value);
  }
}, 180_000);

afterAll(() => {
  running.forEach((p) => p.kill());
  provider.server.stop(true);
  rmSync(work, { recursive: true, force: true });
});

type Received = KnownMessage & { task?: string };

/** One Member's Controller through the relay, collecting what the Machine signed for it. */
function controller(seed: Uint8Array, member: string) {
  const inbox: Received[] = [];
  const ready = Promise.withResolvers<void>();
  const client = startHubClient({
    hubUrl: url,
    secretKey: seed,
    trustedKeys: new Set([machineKey]),
    onReady: () => ready.resolve(),
    onEnvelope: ({ signed }) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, task: signed.task });
    },
  });
  const send = (type: string, body: unknown, task?: string) => client.send({ type, to: "machine-1", member, ...(task ? { task } : {}), body });
  /** The first message from `from` on that matches; waits for it. */
  const next = async (from: number, match: (m: Received) => boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = inbox.slice(from).find(match);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`nothing matched; got ${inbox.slice(from).map((m) => (m.type === "error" ? `error:${m.body.code}` : m.type)).join(", ")}`);
  };
  return { client, ready: ready.promise, inbox, send, next };
}

const errorCode = (m: Received) => (m.type === "error" ? m.body.code : undefined);

test("a Member who is not an Owner reaches an Agent only through a Grant, and loses it on the next Turn once it is taken away", async () => {
  let owner = controller(ownerSeed, "member-1");
  const colleague = controller(colleagueSeed, "member-2");
  await Promise.all([owner.ready, colleague.ready]);
  // One at a time: two creates at once each answer with the list as it was.
  owner.send("agent.create", { id: "shared", name: "Shared", provider: "main", model: "model-a" });
  await owner.next(0, (m) => m.type === "agent.listed" && m.body.agents.length === 1);
  owner.send("agent.create", { id: "private", name: "Private", provider: "main", model: "model-a" });
  await owner.next(0, (m) => m.type === "agent.listed" && m.body.agents.length === 2);

  // No Grant: no work, and nothing an Owner alone may do.
  let from = colleague.inbox.length;
  colleague.send("task.message", { agent: "shared", id: "m0", text: "hi" }, "task-0");
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("agent.forbidden");
  from = colleague.inbox.length;
  colleague.send("agent.list", {});
  const none = await colleague.next(from, (m) => m.type === "agent.listed");
  expect(none.type === "agent.listed" && none.body.agents).toEqual([]);
  from = colleague.inbox.length;
  colleague.send("agent.create", { id: "theirs", name: "Theirs", provider: "main", model: "model-a" });
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("member.forbidden");

  // The Owner grants Use at one Agent; it is kept on the Machine.
  let at = owner.inbox.length;
  from = colleague.inbox.length;
  owner.send("grant.set", { agent: "shared", member: "member-2", level: "use" });
  // The Member's app hears of it without asking or reconnecting.
  const told = await colleague.next(from, (m) => m.type === "agent.listed");
  expect(told.type === "agent.listed" && told.body.agents.map((a) => a.id)).toEqual(["shared"]);
  const listed = await owner.next(at, (m) => m.type === "grants.listed");
  expect(listed.body).toEqual({ agent: "shared", grants: [{ member: "member-2", level: "use" }] });
  expect(JSON.parse(readFileSync(join(home, "runtime/trust.json"), "utf8")).grants).toEqual([{ agent: "shared", member: "member-2", level: "use" }]);

  // Use is enough for a Turn there, and nowhere else; it does not grant others.
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "shared", id: "m1", text: "hi" }, "task-1");
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-1" && m.body.kind === "turn.ended");
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "private", id: "m2", text: "hi" }, "task-2");
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("agent.forbidden");
  from = colleague.inbox.length;
  colleague.send("grant.set", { agent: "shared", member: "member-2", level: "manage" });
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("grant.forbidden");

  // The list names only the Agent granted, with its level, and nothing an Owner alone sees (#100).
  from = colleague.inbox.length;
  colleague.send("agent.list", {});
  const seen = await colleague.next(from, (m) => m.type === "agent.listed");
  if (seen.type !== "agent.listed") throw new Error("not a list");
  expect(seen.body.agents.map((a) => [a.id, a.level])).toEqual([["shared", "use"]]);
  expect(seen.body.owner).toBe(false);
  expect(seen.body.providers).toEqual([]);

  // A Trigger is its signer's: the Member neither sees nor deletes the Owner's, and keeps their own.
  const daily = (id: string) => ({ agent: "shared", trigger: { id, kind: "schedule", text: "check", schedule: { daily: { at: "09:00" } } } });
  at = owner.inbox.length;
  owner.send("trigger.set", daily("tr_owner"));
  await owner.next(at, (m) => m.type === "trigger.listed");
  from = colleague.inbox.length;
  colleague.send("trigger.delete", { agent: "shared", id: "tr_owner" });
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("trigger.forbidden");
  from = colleague.inbox.length;
  colleague.send("trigger.set", daily("tr_mine"));
  const mine = await colleague.next(from, (m) => m.type === "trigger.listed");
  expect(mine.type === "trigger.listed" && mine.body.triggers.map((x) => x.id)).toEqual(["tr_mine"]);

  // An Approval in the Member's own Turn goes to whoever holds Approve (#101): Use does not answer it, the Owner does.
  let calls = 0;
  provider.reply = () => (++calls === 1 ? bashUseSse("touch member-marker") : sse([{ type: "text", text: "done" }]));
  at = owner.inbox.length;
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "shared", id: "m-ap", text: "go" }, "task-ap");
  const asked = await owner.next(at, (m) => m.type === "task.event" && m.task === "task-ap" && m.body.kind === "approval.requested");
  const request = (asked.body as { body: { request: string } }).body.request;
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-ap" && m.body.kind === "approval.requested");
  from = colleague.inbox.length;
  colleague.send("approval.answer", { agent: "shared", request, decision: "approve" }, "task-ap");
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("approval.forbidden");
  owner.send("approval.answer", { agent: "shared", request, decision: "approve" }, "task-ap");
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-ap" && m.body.kind === "turn.ended");
  // The Owner saw the Approval, and nothing else of the Member's Task.
  expect(owner.inbox.filter((m) => m.task === "task-ap").every((m) => m.type === "task.event" && m.body.kind.startsWith("approval."))).toBe(true);

  // An approver who was not connected when it was asked hears of it on their next `task.list`.
  owner.client.stop();
  calls = 0;
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "shared", id: "m-ap2", text: "go" }, "task-ap2");
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-ap2" && m.body.kind === "approval.requested");
  const back = controller(ownerSeed, "member-1");
  await back.ready;
  back.send("task.list", {});
  const late = await back.next(0, (m) => m.type === "task.event" && m.task === "task-ap2" && m.body.kind === "approval.requested");
  back.send("approval.answer", { agent: "shared", request: (late.body as { body: { request: string } }).body.request, decision: "approve" }, "task-ap2");
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-ap2" && m.body.kind === "turn.ended");
  owner = back;

  // A group gives everyone in it its Grants (ADR 0091, #103); taken out of it, the next Turn is refused.
  provider.reply = () => sse([{ type: "text", text: "done" }]);
  const team = (version: number, members: string[], level = "use") => ({ id: "g_team", name: "Team", version, members, admins: [], grants: [{ agent: "private", level }] });
  at = owner.inbox.length;
  from = colleague.inbox.length;
  owner.send("group.set", team(1, ["member-2"]));
  await owner.next(at, (m) => m.type === "groups.listed");
  // Joining a group sends the Member a list with what it gives.
  await colleague.next(from, (m) => m.type === "agent.listed" && m.body.agents.some((a) => a.id === "private"));
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "private", id: "m-g1", text: "hi" }, "task-g");
  await colleague.next(from, (m) => m.type === "task.event" && m.task === "task-g" && m.body.kind === "turn.ended");
  from = colleague.inbox.length;
  colleague.send("group.set", team(2, ["member-2"], "manage"));
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("grant.forbidden");
  at = owner.inbox.length;
  owner.send("group.set", team(2, []));
  await owner.next(at, (m) => m.type === "groups.listed");
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "private", id: "m-g2", text: "again" }, "task-g");
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("agent.forbidden");

  // Taken away: the next Turn is refused.
  at = owner.inbox.length;
  owner.send("grant.set", { agent: "shared", member: "member-2", level: "none" });
  expect((await owner.next(at, (m) => m.type === "grants.listed")).body).toEqual({ agent: "shared", grants: [] });
  from = colleague.inbox.length;
  colleague.send("task.message", { agent: "shared", id: "m3", text: "again" }, "task-1");
  expect(errorCode(await colleague.next(from, (m) => m.type === "error"))).toBe("agent.forbidden");

  owner.client.stop();
  colleague.client.stop();
}, 90_000);
