import { afterEach, expect, test } from "bun:test";
import { createBackoff } from "./backoff";
import { fakeHub, type FakeHub } from "./fake-hub";
import { startHubLink } from "./hub-link";

const machineKey = new Uint8Array(32).fill(0x33); // test-only key

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function link(hub: FakeHub, lines: string[]) {
  const l = startHubLink({ hubUrl: hub.url, secretKey: machineKey, log: (s) => lines.push(s), backoff: createBackoff({ baseMs: 10, capMs: 40 }) });
  cleanup.push(() => l.stop());
  return l;
}

async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

test("accepted: reports it is connected, with the Machine the Hub named", async () => {
  const hub = fakeHub();
  cleanup.push(() => hub.server.stop(true));
  const lines: string[] = [];
  link(hub, lines);
  await until(() => lines.some((l) => l.includes("connected to hub")));
  expect(lines[0]).toBe(`connected to hub ${hub.url} as machine machine-1`);
});

test("rejected: reports why and tries again with backoff", async () => {
  const hub = fakeHub({ accept: false });
  cleanup.push(() => hub.server.stop(true));
  const lines: string[] = [];
  link(hub, lines);
  await until(() => hub.connections >= 3);
  expect(lines[0]).toMatch(/does not know this Machine's key.*\(4401\); retrying in \d+ ms/);
});

test("the Hub restarts: the Runtime reconnects and authenticates again by itself", async () => {
  const first = fakeHub();
  const lines: string[] = [];
  link(first, lines);
  await until(() => lines.filter((l) => l.includes("connected to hub")).length === 1);

  const port = first.server.port;
  first.server.stop(true);
  await until(() => lines.some((l) => l.includes("connection closed")));

  const second = fakeHub({ port });
  cleanup.push(() => second.server.stop(true));
  await until(() => lines.filter((l) => l.includes("connected to hub")).length === 2);
  expect(second.connections).toBe(1);
});

test("a Hub that is not there yet is retried until it is", async () => {
  const probe = fakeHub();
  const port = probe.server.port;
  probe.server.stop(true);
  const lines: string[] = [];
  const gone = { ...probe, url: `ws://127.0.0.1:${port}` };
  link(gone, lines);
  await until(() => lines.filter((l) => l.includes("unreachable")).length >= 2);

  const hub = fakeHub({ port });
  cleanup.push(() => hub.server.stop(true));
  await until(() => lines.some((l) => l.includes("connected to hub")));
});
