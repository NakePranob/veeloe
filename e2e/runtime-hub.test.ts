import { afterAll, expect, test } from "bun:test";
import { answerChallenge, HubCloseCode, publicKeyOf, toBase64url } from "@veeloe/protocol";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbDsn, handshakeTimeoutMs, hubWsUrl, restartHub, runtimeBinary } from "./hub";

// Pairing comes with #9; until then a test puts the Machine's key straight
// into the Hub's database. TEST-ONLY KEYS, from fixed seeds.
const sql = new Bun.SQL(dbDsn);
afterAll(() => sql.close());

let nextSeed = 0x40;
async function seededMachine() {
  const secret = new Uint8Array(32).fill(nextSeed++);
  const id = crypto.randomUUID();
  await sql`insert into machine_svc.machines (id, workspace_id, public_key)
            values (${id}, ${crypto.randomUUID()}, ${Buffer.from(publicKeyOf(secret))})`;
  return { id, secret };
}

/** A raw client: the first frame it gets, and how the Hub ended the connection. */
function rawClient(onChallenge: (nonce: string, ws: WebSocket) => void) {
  const ws = new WebSocket(`${hubWsUrl}/connect`);
  const frames: string[] = [];
  const closed = new Promise<number>((resolve) => (ws.onclose = (e) => resolve(e.code)));
  ws.onmessage = (e) => {
    frames.push(String(e.data));
    const msg = JSON.parse(String(e.data));
    if (msg.type === "hub.challenge") onChallenge(msg.nonce, ws);
  };
  return { ws, frames, closed };
}

async function within<T>(ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([p, Bun.sleep(ms).then(() => Promise.reject(new Error(`nothing within ${ms} ms`)))]);
}

test("the real Runtime connects with its key, and reconnects by itself after the Hub restarts", async () => {
  const { id, secret } = await seededMachine();
  const home = mkdtempSync(join(tmpdir(), "veeloe-home-"));
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "machine.key"), secret, { mode: 0o600 });

  const runtime = Bun.spawn([runtimeBinary], { env: { VEELOE_HOME: home, VEELOE_HUB_URL: hubWsUrl }, stdout: "pipe" });
  const reader = runtime.stdout.getReader();
  let out = "";
  const connectedTimes = () => out.split(`as machine ${id}`).length - 1;
  async function waitForConnected(times: number) {
    while (connectedTimes() < times) {
      const { value, done } = await within(15_000, reader.read());
      if (done) throw new Error(`the Runtime exited:\n${out}`);
      out += new TextDecoder().decode(value);
    }
  }

  try {
    await waitForConnected(1);
    expect(out).toContain(`machine key ${toBase64url(publicKeyOf(secret))}`);
    expect(out).toContain(`connected to hub ${hubWsUrl} as machine ${id}`);

    await restartHub();
    await waitForConnected(2);
  } finally {
    runtime.kill();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test("a key the Hub does not know is refused", async () => {
  const stranger = new Uint8Array(32).fill(0x22);
  const c = rawClient((nonce, ws) => ws.send(JSON.stringify(answerChallenge(hubWsUrl, nonce, stranger))));
  expect(await within(2000, c.closed)).toBe(HubCloseCode.AuthFailed);
});

test("a signature that does not check out is refused", async () => {
  const { secret } = await seededMachine();
  const c = rawClient((nonce, ws) => {
    const answer = answerChallenge(hubWsUrl, nonce, secret);
    ws.send(JSON.stringify({ ...answer, sig: answerChallenge(hubWsUrl, `${nonce}x`, secret).sig }));
  });
  expect(await within(2000, c.closed)).toBe(HubCloseCode.AuthFailed);
});

test("an answer signed for another Hub is refused", async () => {
  const { secret } = await seededMachine();
  const c = rawClient((nonce, ws) => ws.send(JSON.stringify(answerChallenge("wss://evil.example.com", nonce, secret))));
  expect(await within(2000, c.closed)).toBe(HubCloseCode.AuthFailed);
});

test("an answer from an earlier connection is refused", async () => {
  const { id, secret } = await seededMachine();
  let answer = "";
  const first = rawClient((nonce, ws) => {
    answer = JSON.stringify(answerChallenge(hubWsUrl, nonce, secret));
    ws.send(answer);
  });
  await within(2000, (async () => {
    while (!first.frames.some((f) => f.includes("hub.ready"))) await Bun.sleep(10);
  })());
  expect(JSON.parse(first.frames[1]!)).toEqual({ type: "hub.ready", machine: id });
  first.ws.close();

  const replay = rawClient((_nonce, ws) => ws.send(answer));
  expect(await within(2000, replay.closed)).toBe(HubCloseCode.AuthFailed);
});

test("a client that never answers is closed when the handshake times out", async () => {
  const c = rawClient(() => {});
  const started = Date.now();
  expect(await within(handshakeTimeoutMs + 2000, c.closed)).toBe(HubCloseCode.HandshakeTimeout);
  expect(Date.now() - started).toBeGreaterThanOrEqual(handshakeTimeoutMs - 50);
});

test("a frame other than the answer, before authenticating, is refused", async () => {
  const c = rawClient((_nonce, ws) => ws.send(JSON.stringify({ type: "task.message", to: "agent-1" })));
  expect(await within(2000, c.closed)).toBe(HubCloseCode.AuthFailed);
});
