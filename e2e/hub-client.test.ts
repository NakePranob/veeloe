import { afterAll, beforeAll, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { answerChallenge, createSigner, MemorySeenSequences, parseFrame, publicKeyOf, toBase64url, verify, type Route } from "@veeloe/protocol-ts";
import { startHubClient } from "../controller/src/shared/hub-client";

// The Controller's real client through the real relay. TEST-ONLY KEYS, the seeds cmd/testhub knows.
const machineSeed = new Uint8Array(32).fill(0x33);
const controllerSeed = new Uint8Array(32).fill(0x44);
const machineKey = toBase64url(publicKeyOf(machineSeed));
const controllerKey = toBase64url(publicKeyOf(controllerSeed));

let hub: ReturnType<typeof Bun.spawn>;
let url: string;

beforeAll(async () => {
  const binary = `${tmpdir()}/veeloe-testhub-client-${process.pid}`;
  const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/testhub"], { cwd: `${import.meta.dir}/../hub`, stderr: "inherit" });
  if (!build.success) throw new Error("could not build the Hub");
  hub = Bun.spawn([binary], { stdout: "pipe", stderr: "inherit" });
  const { value } = await (hub.stdout as ReadableStream<Uint8Array>).getReader().read();
  url = new TextDecoder().decode(value).trim();
}, 120_000);

afterAll(() => {
  hub.kill();
});

test("what the client signs passes verify at the Machine, and it reads the Machine's answer", async () => {
  const machine = new WebSocket(`${url}/connect`);
  const arriving = new Promise<unknown>((resolve) => {
    machine.onmessage = (event) => {
      const frame = parseFrame(String(event.data));
      if (frame.kind === "message" && frame.message.type === "hub.challenge") machine.send(JSON.stringify(answerChallenge(url, frame.message.nonce, machineSeed)));
      else if (frame.kind === "unknown") resolve(JSON.parse(String(event.data)));
    };
  });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const answered = Promise.withResolvers<unknown>();
  const client = startHubClient({
    hubUrl: url,
    secretKey: controllerSeed,
    trustedKeys: new Set([machineKey]),
    onReady: () => client.send({ type: "task.message", to: "machine-1", member: "member-1", body: { text: "สวัสดี" } }),
    onEnvelope: ({ signed }) => answered.resolve(signed.body),
  });

  const atMachine = verify(await arriving, new Set([controllerKey]), (route: Route) => "to" in route && route.to === "machine-1", new MemorySeenSequences());
  expect(atMachine).toMatchObject({ ok: true, signed: { body: { text: "สวัสดี" } } });
  if (atMachine.ok) expect(atMachine.signed.seq).toBeGreaterThan(1_700_000_000_000);

  machine.send(JSON.stringify(createSigner(machineSeed, () => 1)({ type: "task.event", recipients: ["member-1"], body: { state: "done" } })));
  expect(await answered.promise).toEqual({ state: "done" });

  client.stop();
  machine.close();
});

test("the client hears the Hub's error about what it sent", async () => {
  const heard = Promise.withResolvers<string>();
  const client = startHubClient({
    hubUrl: url,
    secretKey: controllerSeed,
    trustedKeys: new Set([machineKey]),
    onReady: () => client.send({ type: "task.message", to: "no-such-machine", body: {} }),
    onHubError: (error) => heard.resolve(error.code),
  });
  expect(await heard.promise).toBe("hub.machine_offline");
  client.stop();
});
