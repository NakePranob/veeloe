import { ed25519 } from "@noble/curves/ed25519.js";

// ADR 0012: Ed25519 from @noble everywhere on the TypeScript side. A secret key
// is the 32-byte RFC 8032 seed.

export function generateSecretKey(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

export function publicKeyOf(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

/** False, never a throw, for a malformed key or signature. */
export function verifySignature(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
