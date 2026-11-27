import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, publicKeyOf, toBase64url, type KnownMessage } from "@veeloe/protocol-ts";
import { RTCPeerConnection } from "werift";
import { openDirect, type Peer } from "../controller/src/features/machine-link/model/direct";
import { startHubClient } from "../controller/src/shared/hub-client";
import { buildRuntime } from "../scripts/runtime";

// The compiled `veeloe` through the real relay, and a Controller whose direct link (ADR 0090) is
// the app's own `openDirect` over werift's browser-shaped WebRTC. TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));

const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-direct-"));
const home = join(work, "home");
const running: ReturnType<typeof Bun.spawn>[] = [];
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

  mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "machine.key"), machineSeed, { mode: 0o600 });
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: url }), { mode: 0o600 });
  writeFileSync(join(home, "runtime/trust.json"), JSON.stringify({ owners: [{ member: "member-1", keys: [toBase64url(publicKeyOf(controllerSeed))] }] }), { mode: 0o600 });
  chmodSync(home, 0o700);

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
  rmSync(work, { recursive: true, force: true });
});

/** werift's peer, in the shape the app's `openDirect` takes; react-native-webrtc's adapter is the same. */
function weriftPeer(): Peer {
  const connection = new RTCPeerConnection({ iceServers: [] });
  return {
    get iceGatheringState() {
      return connection.iceGatheringState;
    },
    get connectionState() {
      return connection.connectionState;
    },
    get localDescription() {
      const sdp = connection.localDescription?.sdp;
      return sdp ? { sdp } : null;
    },
    createDataChannel(label) {
      const channel = connection.createDataChannel(label, { ordered: true });
      return {
        get readyState() {
          return channel.readyState;
        },
        send: (text) => channel.send(text),
        close: () => channel.close(),
        addEventListener: (type, listener) => {
          if (type === "message") channel.addEventListener("message", (event) => listener({ data: (event as { data?: unknown }).data }));
          else channel.addEventListener(type, () => listener({}));
        },
      };
    },
    createOffer: async () => {
      const offer = await connection.createOffer();
      return { type: offer.type, sdp: offer.sdp };
    },
    setLocalDescription: async (description) => void (await connection.setLocalDescription({ type: description.type === "offer" ? "offer" : "answer", sdp: description.sdp ?? "" })),
    setRemoteDescription: async (description) => void (await connection.setRemoteDescription(description)),
    addEventListener: (type, listener) => connection.addEventListener(type, () => listener()),
    close: () => void connection.close(),
  };
}

test("a direct link carries the Controller's envelopes and the Machine's answers instead of the Hub, and the Hub takes them again once it closes", async () => {
  /** Each envelope with the way it came. */
  const inbox: (KnownMessage & { via: "hub" | "direct" })[] = [];
  let viaDirect = false;
  const ready = Promise.withResolvers<void>();
  const client = startHubClient({
    hubUrl: url,
    secretKey: controllerSeed,
    trustedKeys: new Set([machineKey]),
    onReady: () => ready.resolve(),
    onEnvelope: ({ signed }) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message") inbox.push({ ...parsed.message, via: viaDirect ? "direct" : "hub" });
    },
  });
  const send = (type: string, body: unknown) => client.send({ type, to: "machine-1", member: "member-1", body });
  const waitFor = async (match: (m: (typeof inbox)[number]) => boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = inbox.find(match);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`nothing matched; got ${inbox.map((m) => `${m.type}/${m.via}`).join(", ")}`);
  };
  await ready.promise;

  // Through the Hub first, as every Controller does today.
  send("agent.list", {});
  await waitFor((m) => m.type === "agent.listed" && m.via === "hub");

  const opened = Promise.withResolvers<void>();
  let closed = false;
  const link = openDirect({
    createPeer: weriftPeer,
    newId: () => "dl_e2e",
    offer: (body) => send("direct.offer", body),
    onOpen: (write) => {
      client.setDirect("machine-1", write);
      opened.resolve();
    },
    onClose: () => {
      closed = true;
      client.setDirect("machine-1", undefined);
    },
    onFrame: (text) => {
      viaDirect = true;
      try {
        client.receive(text);
      } finally {
        viaDirect = false;
      }
    },
  });
  const answer = await waitFor((m) => m.type === "direct.answer");
  expect(answer.via).toBe("hub");
  if (answer.type === "direct.answer") link.answer(answer.body.id, answer.body.sdp);
  await opened.promise;

  // On the link: the Controller's command goes on it, and the Machine's answer comes back on it, not through the Hub.
  const before = inbox.length;
  send("agent.list", {});
  const direct = await waitFor((m, i = inbox.indexOf(m)) => i >= before && m.type === "agent.listed");
  expect(direct.via).toBe("direct");
  await Bun.sleep(300);
  expect(inbox.slice(before).filter((m) => m.via === "hub")).toEqual([]);

  // Closed the way the app closes it: `direct.close` on the link, then a short drain. The Hub carries everything again.
  send("direct.close", { id: link.id });
  client.setDirect("machine-1", undefined);
  link.close(1500);
  // Sent while the link winds down: its answer may still come on the link, read during the drain, but it is not lost.
  const during = inbox.length;
  send("agent.list", {});
  await waitFor((m, i = inbox.indexOf(m)) => i >= during && m.type === "agent.listed");
  await Bun.sleep(1600);
  expect(closed).toBe(true);
  const after = inbox.length;
  send("agent.list", {});
  const back = await waitFor((m, i = inbox.indexOf(m)) => i >= after && m.type === "agent.listed");
  expect(back.via).toBe("hub");
  client.stop();
}, 60_000);
