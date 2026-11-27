import { expect, test } from "bun:test";
import { hashBytes, toBase64url } from "@veeloe/protocol-ts";
import { DIRECT_MAX_BYTES } from "./direct";
import { attachmentPlan, DIRECT_CHUNK_BYTES, DIRECT_ONLY_BYTES, decodeChunks, isFileHash, MAX_ATTACHMENT_BYTES, MAX_DOWNLOAD_CHUNKS, safeFileName } from "./downloads";

test("chunks decode on their own, so a chunk that does not end on a three-byte boundary keeps its bytes", () => {
  const bytes = new Uint8Array(256 * 1024 + 1000).map((_, index) => index % 256);
  const first = bytes.slice(0, 256 * 1024);
  const second = bytes.slice(256 * 1024);
  expect(decodeChunks([toBase64url(first), toBase64url(second)])).toEqual(bytes);
});

test("a downloaded name cannot leave its cache folder", () => {
  expect(safeFileName("../../etc/passwd")).toBe("passwd");
  expect(safeFileName("report:final?.txt")).toBe("report_final_.txt");
  expect(safeFileName("..")).toBe("file");
});

test("only a SHA-256 in base64url may name the cache folder", () => {
  expect(isFileHash(hashBytes(new Uint8Array([1])))).toBe(true);
  expect(isFileHash("../../etc/passwd")).toBe(false);
  expect(isFileHash("F3n7E6uzbAnmB7hO")).toBe(false);
});

test("a file over 1 MB goes only on the direct link, in chunks that fit it (ADR 0090)", () => {
  expect(attachmentPlan(DIRECT_ONLY_BYTES)).toEqual({ chunk: 256 * 1024, directOnly: false });
  expect(attachmentPlan(DIRECT_ONLY_BYTES + 1)).toEqual({ chunk: DIRECT_CHUNK_BYTES, directOnly: true });
  // A direct chunk, base64url and signed, still fits under the link's 64 KB.
  expect(Math.ceil(DIRECT_CHUNK_BYTES / 3) * 4 + 2000).toBeLessThan(DIRECT_MAX_BYTES);
  // The largest file still fits the chunk count a download accepts.
  expect(Math.ceil(MAX_ATTACHMENT_BYTES / DIRECT_CHUNK_BYTES)).toBeLessThanOrEqual(MAX_DOWNLOAD_CHUNKS);
});
