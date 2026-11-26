/**
 * Exponential backoff with full jitter: attempt n waits a random time up to
 * min(cap, base * 2^n), so Runtimes that lost the Hub together do not all
 * come back at the same instant. reset() after a successful connection.
 */
export function createBackoff({ baseMs = 1000, capMs = 30_000, random = Math.random } = {}) {
  let attempt = 0;
  return {
    next(): number {
      const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
      attempt = Math.min(attempt + 1, 30); // 2^30 * base is past any cap
      return Math.round(random() * ceiling);
    },
    reset() {
      attempt = 0;
    },
  };
}
