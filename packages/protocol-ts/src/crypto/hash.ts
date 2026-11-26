import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64url } from "./base64url";

/** The hash a Task message declares and every file chunk is checked against. */
export function hashBytes(bytes: Uint8Array): string {
  return toBase64url(sha256(bytes));
}
