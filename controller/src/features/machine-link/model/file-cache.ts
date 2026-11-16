import { hashBytes } from "@veeloe/protocol-ts";
import { Directory, File, Paths } from "expo-file-system";
import { decodeChunks, isFileHash, MAX_CHUNK_TEXT, MAX_DOWNLOAD_CHUNKS, safeFileName, type Download } from "./downloads";
import { openDownloadedFile } from "./open-file";

type Waiter = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Files an Agent offered: asked for with `file.get`, put together from
 * `file.chunk`, kept under the cache and handed to the OS. A File card's press
 * waits until its file is on disk, so the card can say when it failed.
 */
export function createFileCache() {
  const waiters = new Map<string, Set<Waiter>>();
  const downloads = new Map<string, Download>();
  /** The name the card asked for, so the cache lookup and the write agree even if chunks say another. */
  const names = new Map<string, string>();
  /** A hash being written or opened; a retransmitted chunk set must not open it twice. */
  const opening = new Set<string>();

  function settle(hash: string, error?: Error) {
    downloads.delete(hash);
    names.delete(hash);
    const waiting = waiters.get(hash);
    if (!waiting) return;
    waiters.delete(hash);
    for (const waiter of waiting) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  /** Downloaded files live under the cache, one folder per hash, so two files with one name cannot collide. */
  function cachedFile(hash: string, name: string): File {
    return new File(new Directory(Paths.cache, "veeloe-files", hash), safeFileName(name));
  }

  async function keepAndOpen(hash: string, download: Download) {
    let written = false;
    try {
      const bytes = decodeChunks(download.chunks as string[]);
      // The Machine checked this before chunking; checking again here keeps a bad cache out.
      if (hashBytes(bytes) !== hash) {
        settle(hash, new Error("attachment.invalid"));
        return;
      }
      const file = cachedFile(hash, download.name);
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      await file.write(bytes);
      written = true;
      await openDownloadedFile(file);
      settle(hash);
    } catch {
      settle(hash, new Error(written ? "attachment.open" : "attachment.invalid"));
    } finally {
      opening.delete(hash);
    }
  }

  return {
    settle,

    /** One `file.chunk` from the Machine. Only a File card that is waiting may put bytes on disk. */
    chunk(body: { file?: unknown; index?: unknown; total?: unknown; data?: unknown; name?: unknown }) {
      if (typeof body.file !== "string" || typeof body.index !== "number" || typeof body.total !== "number" || typeof body.data !== "string") return;
      if (!isFileHash(body.file) || !waiters.has(body.file) || opening.has(body.file)) return;
      if (!Number.isInteger(body.total) || body.total < 1 || !Number.isInteger(body.index) || body.index < 0 || body.index >= body.total) return;
      if (body.total > MAX_DOWNLOAD_CHUNKS || body.data.length > MAX_CHUNK_TEXT) {
        settle(body.file, new Error("attachment.too_large"));
        return;
      }
      const item = downloads.get(body.file) ?? {
        total: body.total,
        chunks: new Array<string | undefined>(body.total).fill(undefined),
        name: names.get(body.file) ?? safeFileName(typeof body.name === "string" ? body.name : `${body.file.slice(0, 8)}.bin`),
      };
      if (item.total !== body.total) return;
      item.chunks[body.index] = body.data;
      downloads.set(body.file, item);
      if (item.chunks.every((chunk) => typeof chunk === "string")) {
        opening.add(body.file);
        downloads.delete(body.file);
        void keepAndOpen(body.file, item);
      }
    },

    /**
     * Opens a file at once from the cache, or waits for its chunks after `ask`
     * sends `file.get`; `ask` returns false when nothing went.
     */
    async open(hash: string, name: string, ask: () => boolean) {
      if (!isFileHash(hash)) throw new Error("attachment.invalid");
      const cached = cachedFile(hash, name);
      if (cached.exists) {
        try {
          if (hashBytes(await cached.bytes()) === hash) return await openDownloadedFile(cached);
        } catch {
          // A cache file we cannot read is no better than none.
        }
        cached.delete();
      }
      return new Promise<void>((resolve, reject) => {
        const alreadyAsked = waiters.has(hash);
        const waiting = waiters.get(hash) ?? new Set<Waiter>();
        const waiter = {
          resolve,
          reject,
          timer: setTimeout(() => settle(hash, new Error("attachment.timeout")), 120_000),
        };
        waiting.add(waiter);
        waiters.set(hash, waiting);
        if (alreadyAsked) return;
        names.set(hash, safeFileName(name));
        downloads.delete(hash);
        if (!ask()) {
          clearTimeout(waiter.timer);
          waiting.delete(waiter);
          names.delete(hash);
          if (waiting.size === 0) waiters.delete(hash);
          reject(new Error("hub.machine_offline"));
        }
      });
    },
  };
}
