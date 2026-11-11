import { expect, test } from "bun:test";
import { hashBytes, toBase64url } from "@veeloe/protocol-ts";
import { decodeChunks, isFileHash, safeFileName } from "./downloads";

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
