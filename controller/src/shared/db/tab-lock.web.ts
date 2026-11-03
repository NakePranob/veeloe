// A browser opens the database in one tab at a time (ADR 0021). The holder keeps a
// Web Lock, which the browser frees when the tab goes, and hands over when another
// tab asks on the channel.
//
// expo-sqlite's worker keeps its OPFS handles until the page is gone: closeAsync
// does not free them, and a failed open breaks that worker for good. So handing
// over means reloading, both for the tab that lets go and for a tab whose open
// lost the race against the old worker dying, which Safari can take seconds over.
// An open with no hand-over behind it gets one quick retry, since a reload can race
// its own old worker too, so that a private window, where waiting will not help,
// is told soon.
const LOCK = "veeloe-database";
const RETRY_KEY = "veeloe-database-retry";
const RETRY_DELAYS_AFTER_TAKE_OVER_MS = [500, 1000, 2000, 4000];
const RETRY_DELAYS_AT_START_MS = [500];
// The lock can free a moment before the old worker's handles do.
const HANDLES_GRACE_MS = 150;

let channel: BroadcastChannel | undefined;
let held = false;
let waiting: Promise<boolean> | undefined;
let tookOver = false;

function hold(options: LockOptions, onTaken: () => Promise<void>) {
  channel ??= new BroadcastChannel(LOCK);
  channel.onmessage = async () => {
    if (!held) return;
    await onTaken();
    location.reload();
  };
  return new Promise<boolean>((resolve, reject) => {
    navigator.locks
      .request(LOCK, options, (lock) => {
        if (!lock) return resolve(false);
        held = true;
        resolve(true);
        // Held until this page goes.
        return new Promise<void>(() => {});
      })
      .catch(reject);
  });
}

/**
 * True when this tab now holds the database, false when another tab does.
 * After a retry reload this tab asked first, so it waits its turn.
 * ponytail: without Web Locks (plain http on a LAN) tabs are not told apart, and a second tab fails on opening; add a check if someone serves it that way.
 */
export function tryHoldDatabase(onTaken: () => Promise<void>) {
  if (!navigator.locks) return Promise.resolve(true);
  return hold(sessionStorage.getItem(RETRY_KEY) ? {} : { ifAvailable: true }, onTaken);
}

/**
 * Asks the holder to let go and waits for the lock. Pressing again while waiting
 * only asks again, because a second request would queue behind this tab's own first.
 */
export async function takeOverDatabase(onTaken: () => Promise<void>) {
  tookOver = true;
  waiting ??= hold({}, onTaken).finally(() => (waiting = undefined));
  channel?.postMessage("take");
  await waiting;
  await new Promise((resolve) => setTimeout(resolve, HANDLES_GRACE_MS));
}

/** True when the page will reload to open again with a new worker; false when there is no point or the tries ran out. */
export function retryOpenAfterReload() {
  const saved = sessionStorage.getItem(RETRY_KEY);
  const [delay, ...rest]: number[] = saved ? JSON.parse(saved) : tookOver ? RETRY_DELAYS_AFTER_TAKE_OVER_MS : RETRY_DELAYS_AT_START_MS;
  if (delay === undefined) {
    sessionStorage.removeItem(RETRY_KEY);
    return false;
  }
  sessionStorage.setItem(RETRY_KEY, JSON.stringify(rest));
  setTimeout(() => location.reload(), delay);
  return true;
}

export const openedDatabase = () => sessionStorage.removeItem(RETRY_KEY);
