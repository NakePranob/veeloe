import { signCertificate } from "@veeloe/protocol";
import { droppedWith, type Device } from "../../../entities/device";
import type { Machine } from "../../../entities/machine";
import { postCertificate, type HubAnswer } from "../../../shared/hub-client";

/** The Member's devices still in use, and what revoking one with these keys kept would take with it. */
export function revocationOf(devices: readonly Device[], device: string, keep: readonly string[]) {
  const live = devices.filter((d) => d.revoked_at === null);
  const drops = droppedWith(live, device, keep);
  return { drops, survivors: live.filter((d) => !drops.includes(d.key)) };
}

/**
 * Revokes a device after a new authentication (ADR 0012). The last device is
 * refused before anything is asked or signed (ADR 0031); the Hub and the Runtime
 * refuse it too. Null means the owner did not authenticate, and nothing went.
 */
export async function revokeDevice(
  authenticate: (use: (key: Uint8Array) => Promise<void>) => Promise<boolean>,
  { device, keep, devices, machine, fetchFn, now = Date.now }: { device: string; keep: string[]; devices: readonly Device[]; machine: Pick<Machine, "hub_url" | "workspace_id" | "member_id">; fetchFn?: typeof fetch; now?: () => number },
): Promise<HubAnswer | null> {
  if (revocationOf(devices, device, keep).survivors.length === 0) return { ok: false, code: "hub.last_device" };
  let answer: HubAnswer | null = null;
  await authenticate(async (key) => {
    const certificate = signCertificate({ type: "device.revoke", workspace: machine.workspace_id, member: machine.member_id, key: device, keep, at: now() }, key);
    answer = await postCertificate(machine.hub_url, "/revocations", certificate, fetchFn);
  });
  return answer;
}
