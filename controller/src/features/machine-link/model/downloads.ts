import { fromBase64url } from "@veeloe/protocol-ts";

/** A file the Agent offered, as the Machine sends it back: one chunk at a time (ADR 0050). */
export type Download = {
  total: number;
  chunks: (string | undefined)[];
  name: string;
};

/** 20 MB; nothing the Agent can offer is meant to be bigger (ADR 0050). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Above this a file goes only on a direct link, never through the Hub (ADR 0090). */
export const DIRECT_ONLY_BYTES = 1024 * 1024;
/** A chunk on the direct link: small enough to fit it once base64url and signed. */
export const DIRECT_CHUNK_BYTES = 32 * 1024;
/** 20 MB at 32 KiB a chunk, the most a file on the direct link comes in. */
export const MAX_DOWNLOAD_CHUNKS = MAX_ATTACHMENT_BYTES / DIRECT_CHUNK_BYTES;

/** How one attachment goes out: through the outbox in 256 KiB chunks, or only on the direct link in small ones. */
export function attachmentPlan(size: number): { chunk: number; directOnly: boolean } {
  return size > DIRECT_ONLY_BYTES ? { chunk: DIRECT_CHUNK_BYTES, directOnly: true } : { chunk: 256 * 1024, directOnly: false };
}
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
  const base =
    name
      .split(/[\\/]/)
      .at(-1)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what a file name must not keep
      ?.replace(/[\0-\x1f\x7f:*?"<>|]/g, "_")
      .trim()
      .slice(0, 120) ?? "";
  return base === "" || base === "." || base === ".." ? "file" : base;
}
