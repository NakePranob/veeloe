import {
  buildPairingRequest,
  ErrorBodySchema,
  hubHttpUrl,
  PAIRING_CLOCK_SKEW_SECONDS,
  pairingProof,
  PairingResponseSchema,
  parseMessage,
  publicKeyOf,
  toBase64url,
  type PairingLink,
} from "@veeloe/protocol";
import { startHubClient } from "../../../shared/hub-client";

export type PairResult = { ok: true; machine: PairedMachine } | { ok: false; code: string };

export type PairedMachine = { id: string; publicKey: string; name: string; hubUrl: string; workspace: string; member: string };

export type PairOptions = {
  link: PairingLink;
  secretKey: Uint8Array;
  fetchFn?: typeof fetch;
  /** How often to repeat the claim while the Machine has not answered. */
  retryMs?: number;
  /** When to give up, in milliseconds on this device's clock. */
  giveUpAt?: number;
};

/**
 * The Controller's half of a Pairing (ADR 0013): both signatures to the Hub, then
 * a claim to the Machine until it answers. Only an answer signed by the key in
 * the link counts, whatever the Hub passes along or says about it.
 */
export async function pairMachine({ link, secretKey, fetchFn = fetch, retryMs = 2000, giveUpAt = (link.expires + PAIRING_CLOCK_SKEW_SECONDS) * 1000 }: PairOptions): Promise<PairResult> {
  let response: Response;
  let payload: unknown;
  try {
    response = await fetchFn(`${hubHttpUrl(link.hub)}/pairings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPairingRequest(link, secretKey)),
    });
    payload = await response.json();
  } catch {
    return { ok: false, code: "pairing.hub_unreachable" };
  }
  if (!response.ok) {
    const error = ErrorBodySchema.safeParse((payload as { error?: unknown } | null)?.error);
    return { ok: false, code: error.success ? error.data.code : "pairing.hub_unreachable" };
  }
  const registered = PairingResponseSchema.safeParse(payload);
  if (!registered.success) return { ok: false, code: "pairing.hub_unreachable" };
  const { member, workspace, machine } = registered.data;

  const proof = pairingProof({ secret: link.secret, machine: link.machine, controller: toBase64url(publicKeyOf(secretKey)), member });

  return new Promise((resolve) => {
    let lastProblem = "pairing.timed_out";
    const sendClaim = () => client.send({ type: "pairing.claim", to: machine, body: { member, proof } });
    const finish = (result: PairResult) => {
      clearInterval(repeat);
      clearTimeout(timeout);
      client.stop();
      resolve(result);
    };
    const client = startHubClient({
      hubUrl: link.hub,
      secretKey,
      trustedKeys: new Set([link.machine]),
      onReady: () => sendClaim(),
      onHubError: (error) => {
        lastProblem = error.code;
      },
      onEnvelope: ({ signed }) => {
        const parsed = parseMessage(signed);
        if (parsed.kind !== "message" || parsed.message.type !== "pairing.done") return;
        finish({ ok: true, machine: { id: machine, publicKey: link.machine, name: parsed.message.body.name, hubUrl: link.hub, workspace, member } });
      },
    });
    const repeat = setInterval(sendClaim, retryMs);
    const timeout = setTimeout(() => finish({ ok: false, code: lastProblem }), Math.max(0, giveUpAt - Date.now()));
  });
}

/** Nothing leaves the app until the owner has authenticated for this Pairing (ADR 0012). Null means they did not. */
export async function pairAfterAuthentication(authenticate: (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>, options: Omit<PairOptions, "secretKey">): Promise<PairResult | null> {
  let result: PairResult | null = null;
  await authenticate(async (key) => {
    result = await pairMachine({ ...options, secretKey: key });
  });
  return result;
}
