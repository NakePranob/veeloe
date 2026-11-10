import {
  buildLinkingLink,
  checkLinkRequestProof,
  LINKING_TTL_SECONDS,
  linkingProof,
  parseMessage,
  signCertificate,
  toBase64url,
  type HubLinkRequest,
  type LinkingLink,
  type SignedPart,
} from "@veeloe/protocol-ts";
import type { Device } from "../../../entities/device";
import type { Machine } from "../../../entities/machine";
import { postCertificate, type HubAnswer } from "../../../shared/hub-client";

/** A new device asking to be linked, after its proof checked out: what the owner approves or not. */
export type LinkAsk = { key: string; name: string };

/**
 * This device's half of Linking (ADR 0013, 0031): a link with its Hub, its own key and
 * a fresh secret to show as a QR, as `veeloe pair` shows one. `take` reads the requests
 * the Hub hands over and lets through only the first whose proof matches the secret,
 * while the link lasts: one the Hub made up or changed, a late one, or a second one,
 * is nothing. The owner still approves what `take` lets through; nothing is signed here.
 */
export function openLink({ hub, ownKey, ttlSeconds = LINKING_TTL_SECONDS, now = Date.now }: { hub: string; ownKey: string; ttlSeconds?: number; now?: () => number }) {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const id = toBase64url(crypto.getRandomValues(new Uint8Array(16)));
  const expires = Math.floor(now() / 1000 + ttlSeconds);
  const text = buildLinkingLink({ hub, to: ownKey, id, secret: secretBytes, expires });
  const link: LinkingLink = { hub, to: ownKey, id, secret: toBase64url(secretBytes), expires };
  secretBytes.fill(0);
  let used = false;
  return {
    link,
    text,
    take(request: HubLinkRequest): LinkAsk | null {
      if (used || now() > expires * 1000 || request.id !== id) return null;
      if (!checkLinkRequestProof({ secret: link.secret, id, key: request.key, name: request.name }, request.proof)) return null;
      // One use: whatever the owner answers, this link asks no more.
      used = true;
      return { key: request.key, name: request.name.trim() };
    },
  };
}

export type OpenLink = ReturnType<typeof openLink>;

/** Why a name cannot be the new device's: empty, or the same as another device of this Member still in use. */
export function nameProblem(name: string, devices: readonly Device[]): "empty" | "taken" | null {
  const chosen = name.trim();
  if (!chosen) return "empty";
  return devices.some((d) => d.revoked_at === null && d.name === chosen) ? "taken" : null;
}

/**
 * Signs the new key into this Member and has the Hub register it. Nothing is
 * signed or sent until the owner has authenticated again (ADR 0012); null means they did not.
 */
export async function approveLink(
  authenticate: (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>,
  { link, ask, name, machine, fetchFn, now = Date.now }: { link: LinkingLink; ask: LinkAsk; name: string; machine: Pick<Machine, "workspace_id" | "member_id">; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  let answer: HubAnswer | null = null;
  await authenticate(async (key) => {
    const certificate = signCertificate({ type: "device.link", workspace: machine.workspace_id, member: machine.member_id, key: ask.key, name: name.trim(), at: now() }, key);
    answer = await postCertificate(link.hub, "/links", certificate, fetchFn);
  });
  return answer;
}

/** What the old device tells the new one, as the exact text its proof covers: the Machines on the link's Hub and the Member's keys. */
export function handoffData(hub: string, machines: readonly Machine[], devices: readonly Device[]) {
  const here = machines.filter((m) => m.hub_url === hub);
  return JSON.stringify({
    workspace: here[0]!.workspace_id,
    member: here[0]!.member_id,
    machines: here.map((m) => ({ id: m.id, key: m.public_key, name: m.name, hub: m.hub_url })),
    keys: devices.filter((d) => d.revoked_at === null).map((d) => ({ key: d.key, name: d.name })),
  });
}

/**
 * Sends the handoff to this Member's own devices again and again until the new
 * key answers `device.linked`, or the link runs out. The new device may still be
 * waiting for the Hub to let it in at first, hence the repeats.
 */
export function handOff({
  link,
  key,
  data,
  send,
  watch,
  retryMs = 3000,
  giveUpAt = link.expires * 1000,
}: {
  link: LinkingLink;
  /** The new device's key, as its request named it. */
  key: string;
  data: string;
  send: (type: string, body: unknown) => unknown;
  watch: (key: string, handler: (signed: SignedPart) => void) => () => void;
  retryMs?: number;
  giveUpAt?: number;
}): Promise<"linked" | "expired"> {
  const body = { data, proof: linkingProof({ secret: link.secret, key, data }) };
  return new Promise((resolve) => {
    const finish = (result: "linked" | "expired") => {
      clearInterval(repeat);
      clearTimeout(timeout);
      unwatch();
      resolve(result);
    };
    // Only the new key's own answer counts: the watch reads nothing else from it.
    const unwatch = watch(key, (signed) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message" && parsed.message.type === "device.linked") finish("linked");
    });
    send("device.handoff", body);
    const repeat = setInterval(() => send("device.handoff", body), retryMs);
    const timeout = setTimeout(() => finish("expired"), Math.max(0, giveUpAt - Date.now()));
  });
}
