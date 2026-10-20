import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSecretKey } from "@veeloe/protocol";

export class KeyFileError extends Error {}

/**
 * The Machine's identity (ADR 0012, 0013): an Ed25519 seed in machine.key,
 * readable and writable by the owner only, created on the first start and
 * reused on every one after. The Runtime will not run on a key others can read.
 */
export function loadOrCreateMachineKey(home: string): Uint8Array {
  const file = join(home, "machine.key");
  try {
    writeFileSync(file, generateSecretKey(), { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    throw new KeyFileError(
      `${file} is open to other users (mode ${mode.toString(8)}); it must be 600 — run: chmod 600 ${file}. ` +
        "On a drive without POSIX permissions (a Windows drive under WSL), move VEELOE_HOME into the Linux filesystem.",
    );
  }
  const key = new Uint8Array(readFileSync(file));
  if (key.length !== 32) throw new KeyFileError(`${file} is not a 32-byte key`);
  return key;
}
