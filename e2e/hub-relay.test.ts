import { afterAll, beforeAll, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { answerChallenge, createSigner, MemorySeenSequences, parseFrame, publicKeyOf, toBase64url, verify, type Route } from "@veeloe/protocol";

// A Controller and a Machine, signing with the real Protocol code, through the
// real relay in Go. TEST-ONLY KEYS, the fixed seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));
const controllerKey = toBase64url(publicKeyOf(controllerSeed));

let hub: ReturnType<typeof Bun.spawn>;
let url: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  // Built first and run directly: `go run` leaves a child behind that kill misses.
  const binary = `${tmpdir()}/veeloe-testhub-${process.pid}`;
  const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!build.success) throw new Error("could not build the Hub");
  hub = Bun.spawn([binary], { stdout: "pipe", stderr: "inherit" });
  const { value } = await (hub.stdout as ReadableStream<Uint8Array>).getReader().read();
  url = new TextDecoder().decode(value).trim();
}, 120_000);

afterAll(() => {
  hub.kill();
  sockets.forEach((socket) => socket.close());
});

// A connected client whose frames arrive in a queue the test can await.
async function connect(seed: Uint8Array) {
  const socket = new WebSocket(`${url}/connect`);
  sockets.push(socket);
  const frames: string[] = [];
  const waiting: ((frame: string) => void)[] = [];
  socket.onmessage = (event) => {
    const next = waiting.shift();
    if (next) next(String(event.data));
    else frames.push(String(event.data));
  };
  const nextFrame = () => new Promise<string>((resolve) => (frames.length ? resolve(frames.shift()!) : waiting.push(resolve)));
  const challenge = parseFrame(await nextFrame());
  if (challenge.kind !== "message" || challenge.message.type !== "hub.challenge") throw new Error("no challenge");
  socket.send(JSON.stringify(answerChallenge(url, challenge.message.nonce, seed)));
  const ready = parseFrame(await nextFrame());
  if (ready.kind !== "message" || ready.message.type !== "hub.ready") throw new Error("not ready");
  return { socket, nextFrame, ready: ready.message };
}

test("a signed envelope crosses the Hub in both directions and verifies on arrival", async () => {
  const machine = await connect(machineSeed);
  const controller = await connect(controllerSeed);
  expect(machine.ready.machine).toBe("machine-1");
  expect(controller.ready.member).toBe("member-1");

  const toMachine = createSigner(controllerSeed, () => 1)({ type: "task.message", to: "machine-1", member: "member-1", body: { text: "สวัสดี" } });
  controller.socket.send(JSON.stringify(toMachine));
  const atMachine = verify(JSON.parse(await machine.nextFrame()), new Set([controllerKey]), (route: Route) => "to" in route && route.to === "machine-1", new MemorySeenSequences());
  expect(atMachine).toMatchObject({ ok: true, signed: { body: { text: "สวัสดี" } } });

  const toMember = createSigner(machineSeed, () => 1)({ type: "task.event", recipients: ["member-1"], body: { state: "done" } });
  machine.socket.send(JSON.stringify(toMember));
  const atController = verify(JSON.parse(await controller.nextFrame()), new Set([machineKey]), (route: Route) => "recipients" in route && route.recipients.includes("member-1"), new MemorySeenSequences());
  expect(atController).toMatchObject({ ok: true, signed: { body: { state: "done" } } });
});

test("a Machine that is offline comes back as a code the sender can match", async () => {
  const controller = await connect(controllerSeed);
  const envelope = createSigner(controllerSeed, () => 2)({ type: "task.message", to: "no-such-machine", body: {} });
  controller.socket.send(JSON.stringify(envelope));
  expect(parseFrame(await controller.nextFrame())).toMatchObject({ kind: "message", message: { type: "hub.error", code: "hub.machine_offline", ref: envelope.sig } });
});
