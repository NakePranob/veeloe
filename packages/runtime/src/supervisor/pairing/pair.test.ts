import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, MemorySeenSequences, pairingProof, parsePairingLink, publicKeyOf, toBase64url, verify, type Envelope } from "@veeloe/protocol";
import { loadConfig } from "../config";
import { fakeHub, type FakeHub } from "../hub-link/fake-hub";
import { runPair } from "./pair";
import { runUnpair } from "./unpair";
import { loadTrust, saveTrust } from "../trust/store";

// TEST-ONLY KEYS.
const controllerSeed = new Uint8Array(32).fill(0x44);
const hubKeySeed = new Uint8Array(32).fill(0x66);
const controllerKey = toBase64url(publicKeyOf(controllerSeed));
const hubKey = toBase64url(publicKeyOf(hubKeySeed));
const member = "m_test";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup({ ttlSeconds = 30, accept = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "veeloe-pair-"));
  const hub: FakeHub = fakeHub({ accept });
  cleanup.push(() => {
    hub.server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });
  const lines: string[] = [];
  const result = runPair({ home, hubUrl: hub.url, log: (l) => lines.push(l), name: "my-mac", ttlSeconds });
  const linkLine = lines.find((l) => l.includes("veeloe://pair?")) ?? "";
  const parsed = parsePairingLink(linkLine.slice(linkLine.indexOf("veeloe://")), Date.now());
  if (!parsed.ok) throw new Error(`no link: ${lines.join("\n")}`);
  return { home, hub, lines, result, link: parsed.link };
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

const claim = (seed: Uint8Array, seq: number, body: unknown, type = "pairing.claim") => createSigner(seed, () => seq)({ type, to: "machine-1", body });

const realProof = (link: { secret: string; machine: string }) => pairingProof({ secret: link.secret, machine: link.machine, controller: controllerKey, member });

test("a right claim makes the key an Owner, answers done signed by the Machine and saves the Hub", async () => {
  const { home, hub, link, result } = setup();
  await until(() => hub.connections === 1 && hub.accept);
  await Bun.sleep(20);
  hub.send(claim(controllerSeed, 1_700_000_000_000, { member, proof: realProof(link) }));

  expect(await result).toBe("paired");
  expect(loadTrust(home)).toEqual({ owners: [{ member, keys: [controllerKey] }], links: [], revoked: [] });
  expect(statSync(join(home, "runtime/trust.json")).mode & 0o777).toBe(0o600);
  expect(loadConfig({ VEELOE_HOME: home }).hubUrl).toBe(hub.url);

  await until(() => hub.frames.length === 1);
  const done = verify(hub.frames[0], new Set([link.machine]), (route) => "recipients" in route && route.recipients.includes(member), new MemorySeenSequences());
  expect(done).toMatchObject({ ok: true, signed: { type: "pairing.done", body: { name: "my-mac" } } });
});

test("a Machine the Hub does not know yet keeps trying until the Controller registers it", async () => {
  const { hub, link, result } = setup({ accept: false });
  await until(() => hub.connections >= 1);
  hub.accept = true;
  await until(() => hub.frames.length === 0 && hub.connections >= 2, 6000);
  await Bun.sleep(20);
  hub.send(claim(controllerSeed, 1, { member, proof: realProof(link) }));
  expect(await result).toBe("paired");
}, 10_000);

test("a Hub swapping in its own key with a proof it saw is refused, and the real claim still works", async () => {
  const { home, hub, link, result, lines } = setup();
  await until(() => hub.connections === 1);
  await Bun.sleep(20);
  // Signed by the Hub's key, carrying the proof from the Controller's real envelope.
  hub.send(claim(hubKeySeed, 1, { member, proof: realProof(link) }));
  await until(() => lines.some((l) => l.includes("did not match")));
  expect(loadTrust(home)).toEqual({ owners: [], links: [], revoked: [] });
  expect(hub.frames).toEqual([]);

  hub.send(claim(controllerSeed, 1, { member, proof: realProof(link) }));
  expect(await result).toBe("paired");
  expect(loadTrust(home).owners[0]?.keys).toEqual([controllerKey]);
  expect(loadTrust(home).owners[0]?.keys).not.toContain(hubKey);
});

test("a proof made for another Member does not count", async () => {
  const { home, hub, link, lines, result } = setup();
  await until(() => hub.connections === 1);
  await Bun.sleep(20);
  hub.send(claim(controllerSeed, 1, { member: "m_other", proof: realProof(link) }));
  await until(() => lines.some((l) => l.includes("did not match")));
  expect(loadTrust(home)).toEqual({ owners: [], links: [], revoked: [] });
  hub.send(claim(controllerSeed, 2, { member, proof: realProof(link) }));
  expect(await result).toBe("paired");
});

test("other envelopes do nothing while waiting: no work, no trust", async () => {
  const { home, hub, link, result } = setup();
  await until(() => hub.connections === 1);
  await Bun.sleep(20);
  hub.send(claim(controllerSeed, 1, { text: "rm -rf" }, "task.message"));
  hub.send({ ...claim(controllerSeed, 2, { member, proof: realProof(link) }), to: "another-machine" } as Envelope);
  hub.send("not an envelope");
  await Bun.sleep(50);
  expect(loadTrust(home)).toEqual({ owners: [], links: [], revoked: [] });
  hub.send(claim(controllerSeed, 3, { member, proof: realProof(link) }));
  expect(await result).toBe("paired");
});

test("time running out ends the wait and trusts nobody", async () => {
  const { home, lines, result } = setup({ ttlSeconds: 0.05 });
  expect(await result).toBe("expired");
  expect(lines.at(-1)).toContain("expired");
  expect(loadTrust(home)).toEqual({ owners: [], links: [], revoked: [] });
  expect(existsSync(join(home, "config.json"))).toBe(false);
});

test("a Machine already paired refuses and keeps its trust", async () => {
  const home = mkdtempSync(join(tmpdir(), "veeloe-pair-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const trust = { owners: [{ member, keys: [controllerKey] }] };
  saveTrust(home, trust);
  const lines: string[] = [];
  expect(await runPair({ home, hubUrl: "ws://127.0.0.1:1", log: (l) => lines.push(l) })).toBe("already-paired");
  expect(lines[0]).toContain("veeloe unpair");
  expect(loadTrust(home)).toMatchObject(trust);
});

test("unpair deletes the trust and the key only after a yes, and a new pair can start", async () => {
  const { home, hub, link, result } = setup();
  await until(() => hub.connections === 1);
  await Bun.sleep(20);
  hub.send(claim(controllerSeed, 1, { member, proof: realProof(link) }));
  await result;

  expect(await runUnpair({ home, confirm: async () => false, log: () => {} })).toBe(false);
  expect(existsSync(join(home, "runtime/trust.json"))).toBe(true);
  expect(existsSync(join(home, "machine.key"))).toBe(true);

  writeFileSync(join(home, "runtime/agents.json"), "[]");
  expect(await runUnpair({ home, confirm: async () => true, log: () => {} })).toBe(true);
  expect(existsSync(join(home, "runtime/agents.json"))).toBe(false);
  for (const file of ["runtime/trust.json", "runtime/seen.json", "machine.key"]) expect(existsSync(join(home, file))).toBe(false);
  expect(existsSync(join(home, "config.json"))).toBe(true);

  const again = await runPair({ home, hubUrl: hub.url, log: () => {}, ttlSeconds: 0.05 });
  expect(again).toBe("expired");
});
