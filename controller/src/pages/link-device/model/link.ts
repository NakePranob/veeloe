import { linkingProof, parseLinkingLink, parseMessage, signCertificate, type LinkingLink, type SignedPart } from "@veeloe/protocol";
import type { Device } from "../../../entities/device";
import type { Machine } from "../../../entities/machine";
import { postCertificate, type HubAnswer } from "../../../shared/hub-client";

const linkProblem = { malformed: "linking.link_malformed", expired: "linking.link_expired" } as const;

/**
 * A link scanned or pasted on this device. One that points at a Hub this device
 * has no Machine on is refused before anything goes anywhere.
 */
export function readLink(text: string, machines: readonly Machine[], now = Date.now()): { ok: true; link: LinkingLink } | { ok: false; code: string } {
  const parsed = parseLinkingLink(text, now);
  if (!parsed.ok) return { ok: false, code: linkProblem[parsed.reason] };
  if (!machines.some((m) => m.hub_url === parsed.link.hub)) return { ok: false, code: "linking.hub_unknown" };
  return parsed;
}

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
  { link, name, machine, fetchFn, now = Date.now }: { link: LinkingLink; name: string; machine: Pick<Machine, "workspace_id" | "member_id">; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  let answer: HubAnswer | null = null;
  await authenticate(async (key) => {
    const certificate = signCertificate({ type: "device.link", workspace: machine.workspace_id, member: machine.member_id, key: link.key, name: name.trim(), at: now() }, key);
    answer = await postCertificate(link.hub, "/links", certificate, fetchFn);
  });
  return answer;
}

/** What the old device tells the new one, as the exact text its proof covers: the Machines on the link's Hub and the Member's keys. */
export function handoffData(link: LinkingLink, machines: readonly Machine[], devices: readonly Device[]) {
  const here = machines.filter((m) => m.hub_url === link.hub);
  return JSON.stringify({
    workspace: here[0]!.workspace_id,
    member: here[0]!.member_id,
    machines: here.map((m) => ({ id: m.id, key: m.public_key, name: m.name, hub: m.hub_url })),
    keys: devices.filter((d) => d.revoked_at === null).map((d) => ({ key: d.key, name: d.name })),
  });
}

/**
 * Sends the handoff to this Member's own devices again and again until the new
 * key answers `device.linked`, or the link runs out. The new device is offline
 * or still waiting for the Hub to let it in at first, hence the repeats.
 */
export function handOff({
  link,
  data,
  send,
  watch,
  retryMs = 3000,
  giveUpAt = link.expires * 1000,
}: {
  link: LinkingLink;
  data: string;
  send: (type: string, body: unknown) => unknown;
  watch: (key: string, handler: (signed: SignedPart) => void) => () => void;
  retryMs?: number;
  giveUpAt?: number;
}): Promise<"linked" | "expired"> {
  const body = { data, proof: linkingProof({ secret: link.secret, key: link.key, data }) };
  return new Promise((resolve) => {
    const finish = (result: "linked" | "expired") => {
      clearInterval(repeat);
      clearTimeout(timeout);
      unwatch();
      resolve(result);
    };
    // Only the new key's own answer counts: the watch reads nothing else from it.
    const unwatch = watch(link.key, (signed) => {
      const parsed = parseMessage(signed);
      if (parsed.kind === "message" && parsed.message.type === "device.linked") finish("linked");
    });
    send("device.handoff", body);
    const repeat = setInterval(() => send("device.handoff", body), retryMs);
    const timeout = setTimeout(() => finish("expired"), Math.max(0, giveUpAt - Date.now()));
  });
}
