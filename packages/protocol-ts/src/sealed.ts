import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { toBase64url } from "./crypto/base64url";

const INFO = new TextEncoder().encode("veeloe-provider-key-v1");

/** The X25519 key that belongs to a Machine's Ed25519 identity. */
export function boxPublic(ed25519Public: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(ed25519Public);
}

/**
 * Seal a Provider key to a Machine (ADR 0005, 0042). The wire form is
 * `ephemeral public || nonce || AES-GCM ciphertext`; the Hub can carry it but
 * cannot open it.
 */
export async function sealFor(ed25519Public: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const recipient = boxPublic(ed25519Public);
  const secret = x25519.utils.randomSecretKey();
  const ephemeral = x25519.getPublicKey(secret);
  const shared = x25519.getSharedSecret(secret, recipient);
  const salt = new Uint8Array(ephemeral.length + recipient.length);
  salt.set(ephemeral);
  salt.set(recipient, ephemeral.length);
  const key = hkdf(sha256, shared, salt, INFO, 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(ephemeral.length + nonce.length + ciphertext.length);
  out.set(ephemeral);
  out.set(nonce, ephemeral.length);
  out.set(ciphertext, ephemeral.length + nonce.length);
  return toBase64url(out);
}
