import { z } from "zod";
import { toBase64url } from "../crypto/base64url";
import { publicKeyOf, sign } from "../crypto/ed25519";

/** The answer to the challenge: who I am, and a signature to prove it. */
export const HubAuthSchema = z.looseObject({
  type: z.literal("hub.auth"),
  /** The client's public key, base64url. */
  key: z.string().min(1),
  /** Ed25519 over handshakeBytes(hubUrl, nonce), base64url. */
  sig: z.string().min(1),
});
export type HubAuth = z.infer<typeof HubAuthSchema>;

/**
 * The form of a Hub URL that both sides sign: lower-case scheme and host, no
 * default port, no path. The Hub URL is in the signature so a Hub cannot pass
 * another Hub's challenge on and log in there as the client (ADR 0016 lets
 * anyone point a Runtime at a Hub of their own).
 */
export function normalizeHubUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Hub URL must start with ws:// or wss://, got ${hubUrl}`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error(`Hub URL must be just scheme, host and port, got ${hubUrl}`);
  }
  return `${url.protocol}//${url.host}`; // URL lower-cases and drops the default port
}

const encoder = new TextEncoder();

/** The bytes a client signs to answer a challenge. The nonce goes in as its base64url text. */
export function handshakeBytes(hubUrl: string, nonce: string): Uint8Array {
  return encoder.encode(`veeloe-hub-auth/1\n${normalizeHubUrl(hubUrl)}\n${nonce}`);
}

export function answerChallenge(hubUrl: string, nonce: string, secretKey: Uint8Array): HubAuth {
  return {
    type: "hub.auth",
    key: toBase64url(publicKeyOf(secretKey)),
    sig: toBase64url(sign(handshakeBytes(hubUrl, nonce), secretKey)),
  };
}
