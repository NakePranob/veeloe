import { z } from "zod";
import { fromBase64url, toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign, verifySignature } from "../crypto/ed25519";
import { normalizeHubUrl } from "./hub-auth";

/** How long a link is good for, from the moment the Machine shows it. */
export const PAIRING_TTL_SECONDS = 600;
/** How far the clocks of a Machine and whoever reads its link may disagree. */
export const PAIRING_CLOCK_SKEW_SECONDS = 120;

const PREFIX = "veeloe://pair?";
const encoder = new TextEncoder();

/**
 * What the Machine signs. The secret is deliberately not in it: the Hub checks
 * this signature and must never see the secret (ADR 0013).
 */
export function pairingLinkBytes(hub: string, machine: string, expires: number): Uint8Array {
  return encoder.encode(`veeloe-pairing-link/1\n${normalizeHubUrl(hub)}\n${machine}\n${expires}`);
}

/** What the Controller signs. The Hub URL stops the signature being used at another Hub. */
export function pairingRequestBytes(hub: string, machine: string, controller: string, expires: number): Uint8Array {
  return encoder.encode(`veeloe-pairing-request/1\n${normalizeHubUrl(hub)}\n${machine}\n${controller}\n${expires}`);
}

export type PairingLink = {
  /** The Hub URL in normal form. */
  hub: string;
  /** The Machine's public key, base64url. */
  machine: string;
  /** The random 256-bit secret, base64url. Stays between the Machine and the Controller. */
  secret: string;
  /** Unix seconds. */
  expires: number;
  /** The Machine's signature over pairingLinkBytes, base64url. */
  sig: string;
};

export function buildPairingLink({ hub, machineSecretKey, secret, expires }: { hub: string; machineSecretKey: Uint8Array; secret: Uint8Array; expires: number }): string {
  const normal = normalizeHubUrl(hub);
  const machine = toBase64url(publicKeyOf(machineSecretKey));
  const sig = toBase64url(sign(pairingLinkBytes(normal, machine, expires), machineSecretKey));
  return `${PREFIX}hub=${encodeURIComponent(normal)}&machine=${machine}&secret=${toBase64url(secret)}&expires=${expires}&sig=${sig}`;
}

export type ParsedPairingLink = { ok: true; link: PairingLink } | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

function decodedLength(text: string): number | undefined {
  try {
    return fromBase64url(text).length;
  } catch {
    return undefined;
  }
}

/** Reads what was scanned or pasted. Only a link the Machine really signed comes back ok. */
export function parsePairingLink(text: string, nowMs: number): ParsedPairingLink {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return { ok: false, reason: "malformed" };

  const fields = new Map<string, string>();
  for (const pair of trimmed.slice(PREFIX.length).split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) fields.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const { machine, secret, expires: expiresText, sig } = Object.fromEntries(fields);
  if (!machine || !secret || !expiresText || !sig || !/^[1-9][0-9]{0,14}$/.test(expiresText)) return { ok: false, reason: "malformed" };
  if (decodedLength(machine) !== 32 || decodedLength(secret) !== 32 || decodedLength(sig) !== 64) return { ok: false, reason: "malformed" };

  let hub: string;
  try {
    hub = normalizeHubUrl(decodeURIComponent(fields.get("hub") ?? ""));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expires = Number(expiresText);
  if (!verifySignature(fromBase64url(sig), pairingLinkBytes(hub, machine, expires), fromBase64url(machine))) return { ok: false, reason: "bad-signature" };
  if (expires + PAIRING_CLOCK_SKEW_SECONDS < nowMs / 1000) return { ok: false, reason: "expired" };
  return { ok: true, link: { hub, machine, secret, expires, sig } };
}

const key = z.string().min(1);

/** `POST /pairings`: the Controller's request, carrying both sides' consent. Never the secret. */
export const PairingRequestSchema = z.looseObject({
  machine: key,
  controller: key,
  expires: z.number().int().positive(),
  machineSig: key,
  controllerSig: key,
});
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

/** The Hub's answer: who the Controller's holder is, and where the Machine now lives. */
export const PairingResponseSchema = z.looseObject({
  workspace: key,
  member: key,
  machine: key,
});
export type PairingResponse = z.infer<typeof PairingResponseSchema>;

export function buildPairingRequest(link: PairingLink, controllerSecretKey: Uint8Array): PairingRequest {
  const controller = toBase64url(publicKeyOf(controllerSecretKey));
  return {
    machine: link.machine,
    controller,
    expires: link.expires,
    machineSig: link.sig,
    controllerSig: toBase64url(sign(pairingRequestBytes(link.hub, link.machine, controller, link.expires), controllerSecretKey)),
  };
}

/** Where to reach the Hub over HTTP: ws becomes http, wss becomes https. */
export function hubHttpUrl(hub: string): string {
  return normalizeHubUrl(hub).replace(/^ws/, "http");
}
