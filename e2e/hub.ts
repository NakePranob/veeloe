import { $ } from "bun";
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Starts Postgres, applies the Hub's migrations, builds the Runtime binary and
// starts the real Hub, once for the whole run (preloaded by bunfig.toml).
// Everything stops when the run ends.
const compose = `${import.meta.dir}/docker-compose.yml`;
const hubDir = `${import.meta.dir}/../hub`;
const work = mkdtempSync(join(tmpdir(), "veeloe-e2e-"));

export const hubUrl = "http://127.0.0.1:18080";
/** What Runtimes dial, and what the Hub binds into every handshake. */
export const hubWsUrl = "ws://127.0.0.1:18080";
export const dbDsn = "postgres://postgres:postgres@127.0.0.1:55432/hub?sslmode=disable";
export const runtimeBinary = join(work, "veeloe");
/** Short, so the timeout case does not slow the run down. */
export const handshakeTimeoutMs = 500;

await $`docker compose -f ${compose} up -d --wait`;
// keep in step with MIGRATE_VERSION in hub/Makefile
await $`go run -tags postgres github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1 -path migrations -database ${dbDsn} up`.cwd(hubDir);
await $`go build -o bin/api ./cmd/api`.cwd(hubDir);
await $`bun build ${import.meta.dir}/../packages/runtime/src/main.ts --compile --outfile ${runtimeBinary}`.quiet();

let hub: ReturnType<typeof Bun.spawn>;

function spawnHub() {
  hub = Bun.spawn([`${hubDir}/bin/api`], {
    env: {
      ...process.env,
      APP_ENV: "development",
      GIN_MODE: "release",
      PORT: "18080",
      DB_DSN: dbDsn,
      HUB_PUBLIC_URL: hubWsUrl,
      HUB_HANDSHAKE_TIMEOUT: `${handshakeTimeoutMs}ms`,
      HUB_HEARTBEAT_INTERVAL: "2s",
    },
    stdout: "ignore",
    stderr: "inherit",
  });
}

async function waitForHub() {
  for (let tries = 0; !(await fetch(`${hubUrl}/livez`).then((r) => r.ok, () => false)); tries++) {
    if (hub.exitCode !== null) throw new Error(`Hub exited with code ${hub.exitCode}`);
    if (tries === 100) throw new Error("Hub did not come up within 10s");
    await Bun.sleep(100);
  }
}

/** Stops the Hub and starts it again, as a deploy or a crash would. */
export async function restartHub() {
  hub.kill();
  await hub.exited;
  spawnHub();
  await waitForHub();
}

async function stop() {
  hub?.kill();
  await hub?.exited;
  await $`docker compose -f ${compose} down`.quiet();
  rmSync(work, { recursive: true, force: true });
}
afterAll(stop);

try {
  spawnHub();
  await waitForHub();
} catch (err) {
  await stop();
  throw err;
}
