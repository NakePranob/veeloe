import { $ } from "bun";
import { afterAll } from "bun:test";

// Starts Postgres and the real Hub once for the whole run (preloaded by
// bunfig.toml), and stops both when the run ends.
const compose = `${import.meta.dir}/docker-compose.yml`;
const hubDir = `${import.meta.dir}/../hub`;
export const hubUrl = "http://127.0.0.1:18080";

await $`docker compose -f ${compose} up -d --wait`;
await $`go build -o bin/api ./cmd/api`.cwd(hubDir);
const hub = Bun.spawn([`${hubDir}/bin/api`], {
  env: {
    ...process.env,
    APP_ENV: "development",
    GIN_MODE: "release",
    PORT: "18080",
    DB_DSN: "postgres://postgres:postgres@127.0.0.1:55432/hub?sslmode=disable",
  },
  stdout: "inherit",
  stderr: "inherit",
});

async function stop() {
  hub.kill();
  await hub.exited;
  await $`docker compose -f ${compose} down`.quiet();
}
afterAll(stop);

try {
  for (let tries = 0; !(await fetch(`${hubUrl}/livez`).then((r) => r.ok, () => false)); tries++) {
    if (hub.exitCode !== null) throw new Error(`Hub exited with code ${hub.exitCode}`);
    if (tries === 100) throw new Error("Hub did not come up within 10s");
    await Bun.sleep(100);
  }
} catch (err) {
  await stop();
  throw err;
}
