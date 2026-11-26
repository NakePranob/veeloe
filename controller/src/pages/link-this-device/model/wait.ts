import { checkLinkingProof, createBackoff, HandoffDataSchema, linkRequestProof, parseLinkingLink, parseMessage, publicKeyOf, toBase64url, type HandoffData, type LinkingLink } from "@veeloe/protocol-ts";
import { postLinkRequest, startHubClient, type HubAnswer } from "../../../shared/hub-client";

export type WaitResult = { ok: true; data: HandoffData } | { ok: false; code: "linking.expired" };

const linkProblem = { malformed: "linking.link_malformed", expired: "linking.link_expired" } as const;

/** A link scanned, opened or pasted on this device. It names the Hub, so this device never asks for one. */
export function readLink(text: string, now = Date.now()): { ok: true; link: LinkingLink } | { ok: false; code: string } {
  const parsed = parseLinkingLink(text, now);
  return parsed.ok ? parsed : { ok: false, code: linkProblem[parsed.reason] };
}

/**
 * Asks the device showing the QR to link this key, by way of the link's Hub. The proof,
 * an HMAC under the QR's secret, is what keeps the Hub from swapping in a key of its own:
 * the other device drops a request it does not match. Nothing is linked yet; the owner
 * approves there.
 */
export function sendLinkRequest({ link, name, secretKey, fetchFn }: { link: LinkingLink; name: string; secretKey: Uint8Array; fetchFn?: typeof fetch }): Promise<HubAnswer> {
  const key = toBase64url(publicKeyOf(secretKey));
  const chosen = name.trim();
  return postLinkRequest(link.hub, { to: link.to, id: link.id, key, name: chosen, proof: linkRequestProof({ secret: link.secret, id: link.id, key, name: chosen }) }, fetchFn);
}

/**
 * The wait after the request (ADR 0013, 0031): at the link's Hub until it knows this key,
 * then for the other device's handoff. Only a handoff whose proof matches the secret and
 * this key counts, from whatever key: the Hub cannot change it or make one up. It ends
 * when the link does.
 */
export function waitForHandoff({ link, secretKey, now = Date.now }: { link: LinkingLink; secretKey: Uint8Array; now?: () => number }) {
  const key = toBase64url(publicKeyOf(secretKey));
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
    const timer = setTimeout(stop, Math.max(0, link.expires * 1000 - now()));
    const client = startHubClient({
      hubUrl: link.hub,
      secretKey: signingKey,
      // The Hub refuses this key until the other device registers it, so ask often.
      backoff: createBackoff({ capMs: 3000 }),
      // Nobody is trusted yet; the proof is the check.
      trustedKeys: { has: () => true },
      onEnvelope: ({ signed }) => {
        const parsed = parseMessage(signed);
        if (parsed.kind !== "message" || parsed.message.type !== "device.handoff") return;
        const { data, proof } = parsed.message.body;
        if (!checkLinkingProof({ secret: link.secret, key, data }, proof)) return;
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
  return { done, stop: () => stop() };
}
