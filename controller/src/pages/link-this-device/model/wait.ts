import { buildLinkingLink, checkLinkingProof, createBackoff, HandoffDataSchema, LINKING_TTL_SECONDS, normalizeHubUrl, parseMessage, publicKeyOf, toBase64url, type HandoffData } from "@veeloe/protocol";
import { startHubClient } from "../../../shared/hub-client";

export type WaitResult = { ok: true; data: HandoffData } | { ok: false; code: "linking.expired" };

/** The Hub as typed, in normal form, or null when it is not a Hub URL. */
export function hubFrom(text: string): string | null {
  try {
    return normalizeHubUrl(text.trim());
  } catch {
    return null;
  }
}

/**
 * The new device's half of Linking (ADR 0013, 0031): a link with a fresh secret
 * to show as a QR, then a wait at the Hub until the Hub knows this key and the
 * old device's handoff arrives. Only a handoff whose proof matches the secret and
 * this key counts, from whatever key: the Hub cannot change it or make one up.
 * The secret lives only in this call and the link.
 */
export function waitForHandoff({ hub, name, secretKey, ttlSeconds = LINKING_TTL_SECONDS, now = Date.now }: { hub: string; name: string; secretKey: Uint8Array; ttlSeconds?: number; now?: () => number }) {
  const key = toBase64url(publicKeyOf(secretKey));
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = toBase64url(secretBytes);
  const expires = Math.floor(now() / 1000 + ttlSeconds);
  const text = buildLinkingLink({ hub, key, name, secret: secretBytes, expires });
  secretBytes.fill(0);
  // ponytail: a copy of the key for the wait, because the session's own is zeroed if the app locks
  // while the owner walks to the other device. It is zeroed when the wait ends.
  const signingKey = secretKey.slice();

  let stop = () => {};
  const done = new Promise<WaitResult>((resolve) => {
    const finish = (result: WaitResult) => {
      clearTimeout(timer);
      client.stop();
      signingKey.fill(0);
      resolve(result);
    };
    stop = () => finish({ ok: false, code: "linking.expired" });
    const timer = setTimeout(stop, ttlSeconds * 1000);
    const client = startHubClient({
      hubUrl: hub,
      secretKey: signingKey,
      // The Hub refuses this key until the old device registers it, so ask often.
      backoff: createBackoff({ capMs: 3000 }),
      // Nobody is trusted yet; the proof is the check.
      trustedKeys: { has: () => true },
      onEnvelope: ({ signed }) => {
        const parsed = parseMessage(signed);
        if (parsed.kind !== "message" || parsed.message.type !== "device.handoff") return;
        const { data, proof } = parsed.message.body;
        if (!checkLinkingProof({ secret, key, data }, proof)) return;
        let handoff: HandoffData;
        try {
          const value = HandoffDataSchema.safeParse(JSON.parse(data));
          if (!value.success) return;
          handoff = value.data;
        } catch {
          return;
        }
        client.send({ type: "device.linked", recipients: [handoff.member], body: {} });
        finish({ ok: true, data: handoff });
      },
    });
  });
  return { text, expires, done, stop: () => stop() };
}
