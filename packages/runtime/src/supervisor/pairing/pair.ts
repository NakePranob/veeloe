import {
  buildPairingLink,
  checkPairingProof,
  createBackoff,
  createSigner,
  HubCloseCode,
  MemorySeenSequences,
  PAIRING_TTL_SECONDS,
  parseMessage,
  publicKeyOf,
  toBase64url,
  verify,
} from "@veeloe/protocol";
import { renderUnicodeCompact } from "uqr";
import { machineName, saveHubUrl } from "../config";
import { startHubLink } from "../hub-link/hub-link";
import { loadOrCreateMachineKey } from "../trust/machine-key";
import { FileSeenSequences, loadTrust, saveTrust } from "../trust/store";

export type PairResult = "paired" | "expired" | "already-paired";

export type PairOptions = {
  home: string;
  hubUrl: string;
  log?: (line: string) => void;
  name?: string;
  ttlSeconds?: number;
};

/**
 * Light squares on a dark background whatever the terminal's theme, as phone
 * cameras expect when a QR is drawn in blocks.
 */
function terminalQr(text: string): string {
  return renderUnicodeCompact(text, { ecc: "L" })
    .split("\n")
    .map((line) => `\x1b[38;5;231;48;5;16m${line}\x1b[0m`)
    .join("\n");
}

/**
 * Shows the link and waits for a Controller to prove it read it (ADR 0013). A
 * claim only counts when its proof covers the key that signed it, so a Hub that
 * saw a real proof cannot put its own key in. The secret lives only in this call.
 *
 * ponytail: a `pairing.done` lost on the way leaves the Controller failing and
 * this Machine paired, and `veeloe unpair` recovers. Answer a repeated claim
 * from the supervisor if that turns out to happen in practice.
 */
export function runPair({ home, hubUrl, log = console.log, name = machineName(), ttlSeconds = PAIRING_TTL_SECONDS }: PairOptions): Promise<PairResult> {
  if (loadTrust(home).owners.length > 0) {
    log("this Machine is already paired. To start over, run: veeloe unpair");
    return Promise.resolve("already-paired");
  }

  const secretKey = loadOrCreateMachineKey(home);
  const machineKey = toBase64url(publicKeyOf(secretKey));
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = toBase64url(secretBytes);
  const link = buildPairingLink({ hub: hubUrl, machineSecretKey: secretKey, secret: secretBytes, expires: Math.floor(Date.now() / 1000 + ttlSeconds) });

  log(terminalQr(link));
  log(`Scan this in the Veeloe app, or paste this link there:\n${link}\n`);
  log(`Waiting up to ${Math.round(ttlSeconds / 60)} minutes for hub ${hubUrl}...`);

  return new Promise((resolve) => {
    // A rejected envelope never moves these, and they count only for this one wait.
    const seenDuringPairing = new MemorySeenSequences();
    let machine: string | undefined;
    let warned = false;

    const finish = (result: PairResult) => {
      clearTimeout(timer);
      hub.stop();
      resolve(result);
    };
    const timer = setTimeout(() => {
      log("the link has expired and nothing was paired. Run veeloe pair again.");
      finish("expired");
    }, ttlSeconds * 1000);

    const hub = startHubLink({
      hubUrl,
      secretKey,
      backoff: createBackoff({ capMs: 3000 }),
      // The Hub refuses this key until the Controller registers it, which is the normal wait.
      log: (line) => {
        if (warned || line.includes(`(${HubCloseCode.AuthFailed})`) || !line.includes("unreachable")) return;
        warned = true;
        log(`cannot reach hub ${hubUrl} yet; still trying`);
      },
      onReady: (id) => {
        machine = id;
      },
      onEnvelope: (value, send) => {
        // Any key may try here: nobody is trusted yet, and the proof is the check.
        const result = verify(value, { has: () => true }, (route) => "to" in route && route.to === machine, seenDuringPairing);
        if (!result.ok) return;
        const parsed = parseMessage(result.signed);
        if (parsed.kind !== "message" || parsed.message.type !== "pairing.claim") return;
        const { member, proof, keys = [], workspace } = parsed.message.body;
        if (!checkPairingProof({ secret, machine: machineKey, controller: result.from, member }, proof)) {
          log("ignored a claim whose proof did not match this link");
          return;
        }

        // The Member's other keys come in the claim, signed by the key the proof vouches for, so a Machine paired from any of their devices trusts them all.
        saveTrust(home, { owners: [{ member, keys: [...new Set([result.from, ...keys])] }], links: [], revoked: [], ...(workspace ? { workspace } : {}) });
        saveHubUrl(home, hubUrl);
        const seen = new FileSeenSequences(home);
        seen.record(result.from, result.signed.seq);
        const signEnvelope = createSigner(secretKey, () => seen.next(machineKey));
        send(signEnvelope({ type: "pairing.done", recipients: [member], body: { name } }));
        log(`paired with hub ${hubUrl}.`);
        finish("paired");
      },
    });
  });
}
