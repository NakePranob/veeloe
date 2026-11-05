import { revokedWith, verifyCertificate } from "@veeloe/protocol";
import type { Trust } from "./store";

/**
 * Trust after the certificates the Hub handed over (ADR 0031). Each is believed
 * for its signature by a key this Machine already trusts for the same Member,
 * never because the Hub sent it, so a Hub can neither add a key nor take one
 * away. Applying the same list again changes nothing.
 *
 * ponytail: a link signed by a key that is revoked is refused whatever `keep`
 * said, because the Hub sends certificates in the order they were made, so a
 * kept key was already trusted before its signer was revoked. A Hub that
 * reorders them can only drop a kept key, which it could do by not relaying anyway.
 */
export function applyCertificates(trust: Trust, certificates: unknown[], log: (line: string) => void = () => {}): Trust {
  const next: Trust = { ...trust, owners: trust.owners.map((o) => ({ ...o, keys: [...o.keys] })), links: [...(trust.links ?? [])], revoked: [...(trust.revoked ?? [])] };
  for (const certificate of certificates) {
    const body = verifyCertificate(certificate);
    if (!body) {
      log("ignored a certificate: bad-signature");
      continue;
    }
    if (next.workspace !== undefined && body.workspace !== next.workspace) {
      log("ignored a certificate: other-workspace");
      continue;
    }
    const owner = next.owners.find((o) => o.member === body.member);
    if (!owner?.keys.includes(body.by)) {
      // Signed by a key this Machine does not trust for that Member: the Hub cannot vouch for one.
      if (!next.revoked!.includes(body.key)) log("ignored a certificate: untrusted-signer");
      continue;
    }
    if (body.type === "device.link") {
      if (next.revoked!.includes(body.key)) continue;
      if (!owner.keys.includes(body.key)) owner.keys.push(body.key);
      if (!next.links!.some((l) => l.key === body.key)) next.links!.push({ key: body.key, by: body.by });
      continue;
    }
    const drops = revokedWith(body.key, next.links!, body.keep);
    const left = owner.keys.filter((k) => !drops.includes(k));
    if (left.length === 0) {
      // Nobody could sign for this Member again; `veeloe unpair` is the way out (ADR 0035).
      log("ignored a revocation that would leave this Member no key");
      continue;
    }
    owner.keys = left;
    for (const key of drops) if (!next.revoked!.includes(key)) next.revoked!.push(key);
  }
  return next;
}
