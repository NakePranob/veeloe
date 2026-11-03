import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";

/**
 * Signed by the Controller's key and sent to the Machine. Only proof of the
 * secret travels: the secret itself stays in the link, away from the Hub.
 */
export const PairingClaimBodySchema = z.looseObject({
  member: z.string().min(1),
  proof: z.string().min(1),
});
export type PairingClaimBody = z.infer<typeof PairingClaimBodySchema>;

/** Signed by the Machine's key and sent back: the Machine now trusts the Controller. */
export const PairingDoneBodySchema = z.looseObject({
  /** The Machine's hostname, for the Controller to show. */
  name: z.string().min(1).max(255),
});
export type PairingDoneBody = z.infer<typeof PairingDoneBodySchema>;

export type PairingProofInput = { secret: string; machine: string; controller: string; member: string };

const encoder = new TextEncoder();

export function pairingProofText({ machine, controller, member }: Omit<PairingProofInput, "secret">): string {
  return `veeloe-pairing-proof/1\n${machine}\n${controller}\n${member}`;
}

/**
 * HMAC-SHA256 keyed by the secret from the link. It covers both keys and the
 * Member, so a Hub that sees it cannot move it to a key of its own, and with a
 * 256-bit secret it cannot guess the secret from it offline.
 */
export function pairingProof({ secret, ...rest }: PairingProofInput): string {
  return toBase64url(hmac(sha256, fromBase64url(secret), encoder.encode(pairingProofText(rest))));
}

export function checkPairingProof(input: PairingProofInput, proof: string): boolean {
  const expected = pairingProof(input);
  if (proof.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return difference === 0;
}
