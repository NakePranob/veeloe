import { createBackoff, normalizeHubUrl, publicKeyOf, toBase64url, verify } from "@veeloe/protocol";
import { ConfigError, loadConfig, runtimeHome } from "./config";
import { startHubLink } from "./hub-link/hub-link";
import { runPair } from "./pair";
import { KeyFileError, loadOrCreateMachineKey } from "./trust/machine-key";
import { FileSeenSequences, loadTrust, TrustFileError, trustedKeys } from "./trust/store";
import { runUnpair } from "./unpair";

export type SupervisorOptions = {
  home: string;
  hubUrl: string;
  secretKey: Uint8Array;
  log?: (line: string) => void;
  backoff?: ReturnType<typeof createBackoff>;
};

/**
 * Stays connected and reads only what the keys in trust.json signed, after
 * checking each envelope against them (ADR 0006). The first command to act on
 * comes with Agents; until then an accepted envelope is only reported.
 */
export function startSupervisor({ home, hubUrl, secretKey, log = console.log, backoff }: SupervisorOptions) {
  const trust = loadTrust(home);
  if (trust.owners.length === 0) log("this Machine is not paired yet, so it takes no commands. Run: veeloe pair");
  const keys = trustedKeys(trust);
  const seen = new FileSeenSequences(home);
  let machine: string | undefined;
  return startHubLink({
    hubUrl,
    secretKey,
    log,
    backoff,
    onReady: (id) => {
      machine = id;
    },
    onEnvelope: (value) => {
      const result = verify(value, keys, (route) => "to" in route && route.to === machine, seen);
      if (result.ok) log(`accepted ${result.signed.type} from ${result.from}`);
      else log(`dropped an envelope: ${result.reason}`);
    },
  });
}

/** Turns what the operator can fix into a message and an exit, not a stack trace. */
async function reporting(work: () => unknown | Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof KeyFileError || err instanceof TrustFileError) {
      console.error(`veeloe: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export function runSupervisor() {
  return reporting(() => {
    const config = loadConfig();
    const secretKey = loadOrCreateMachineKey(config.home);
    console.log(`veeloe supervisor, machine key ${toBase64url(publicKeyOf(secretKey))}`);
    startSupervisor({ home: config.home, hubUrl: config.hubUrl, secretKey });
  });
}

export function runPairCommand(hub: string | undefined) {
  return reporting(async () => {
    const { home, hubUrl } = hub ? { home: runtimeHome(), hubUrl: hub } : loadConfig();
    let normal: string;
    try {
      normal = normalizeHubUrl(hubUrl);
    } catch (err) {
      throw new ConfigError((err as Error).message);
    }
    const result = await runPair({ home, hubUrl: normal });
    process.exit(result === "paired" ? 0 : 1);
  });
}

export function runUnpairCommand() {
  return reporting(async () => {
    const done = await runUnpair({ home: runtimeHome() });
    process.exit(done ? 0 : 1);
  });
}
