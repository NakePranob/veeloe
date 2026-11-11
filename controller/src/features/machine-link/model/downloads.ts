import { fromBase64url } from "@veeloe/protocol-ts";

/** A file the Agent offered, as the Machine sends it back: one chunk at a time (ADR 0050). */
export type Download = {
  total: number;
  chunks: (string | undefined)[];
  name: string;
};

/** 20 MB at 256 KiB a chunk; nothing the Agent can offer is meant to be bigger (ADR 0050). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOWNLOAD_CHUNKS = 80;
/** A 256 KiB chunk in base64url, padding included: ceil(262144 / 3) * 4. */
export const MAX_CHUNK_TEXT = 349_528;

/** A SHA-256 in base64url: 43 URL-safe characters, and safe to use as a folder name. */
export function isFileHash(hash: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(hash);
}

/**
 * The bytes of every chunk, in order. Each chunk is base64url on its own, so
 * joining the text and decoding once would shift the bytes where a chunk does
 * not end on a three-byte boundary — 256 KiB never does.
 */
export function decodeChunks(chunks: readonly string[]): Uint8Array {
  const parts = chunks.map(fromBase64url);
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** A name that can go under the cache folder on every platform, and still says what the file is. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1)?.replace(/[\0-\x1f\x7f:*?"<>|]/g, "_").trim().slice(0, 120) ?? "";
  return base === "" || base === "." || base === ".." ? "file" : base;
}
