import { afterAll, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHub } from "./hub-link/fake-hub";

const work = mkdtempSync(join(tmpdir(), "veeloe-binary-"));
const binary = join(work, "veeloe");
await $`bun build ${import.meta.dir}/../main.ts --compile --outfile ${binary}`.quiet();
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("the built binary creates its key and connects to a Hub", async () => {
  const hub = fakeHub();
  const proc = Bun.spawn([binary], { env: { VEELOE_HOME: join(work, "home"), VEELOE_HUB_URL: hub.url }, stdout: "pipe" });
  try {
    let out = "";
    const reader = proc.stdout.getReader();
    while (!out.includes("connected to hub")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toMatch(/machine key [A-Za-z0-9_-]{43}\n/);
    expect(out).toContain(`connected to hub ${hub.url} as machine machine-1`);
  } finally {
    proc.kill();
    hub.server.stop(true);
  }
});

test("the built binary exits with an error naming both settings when no Hub URL is set", async () => {
  const proc = Bun.spawn([binary], { env: { VEELOE_HOME: join(work, "empty") }, stderr: "pipe" });
  expect(await proc.exited).toBe(1);
  expect(await new Response(proc.stderr).text()).toMatch(/hubUrl.*VEELOE_HUB_URL/);
});
