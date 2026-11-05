export type KeyStatus = "checking" | "none" | "lost" | "locked" | "unlocked";

/** Where the secret lives. Every `read` is one authentication: it throws when refused, and is null when the OS has invalidated the key. */
export interface Vault {
  isSupported(): Promise<boolean>;
  hasKey(): Promise<boolean>;
  create(secret: Uint8Array, prompt: string): Promise<void>;
  read(prompt: string): Promise<Uint8Array | null>;
  /** Deletes the key for good, with no authentication: what a revoked device does. */
  remove(): Promise<void>;
}

export const IDLE_LIMIT_MS = 5 * 60 * 1000;

/** ADR 0012's rules, free of IO: when the key opens, and when it closes again. */
export function createKeySession({ vault, now, generate }: { vault: Vault; now: () => number; generate: () => Uint8Array }) {
  let status: KeyStatus = "checking";
  let secret: Uint8Array | null = null;
  let lastUsed = 0;
  const listeners = new Set<() => void>();

  function set(next: KeyStatus) {
    status = next;
    for (const listener of listeners) listener();
  }

  function open(key: Uint8Array) {
    secret = key;
    lastUsed = now();
    set("unlocked");
  }

  function lock() {
    secret?.fill(0);
    secret = null;
    set("locked");
  }

  const expired = () => now() - lastUsed > IDLE_LIMIT_MS;

  return {
    status: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async load() {
      if (status === "checking") set((await vault.hasKey()) ? "locked" : "none");
    },

    async create(prompt: string): Promise<"created" | "unsupported" | "failed"> {
      if (!(await vault.isSupported())) return "unsupported";
      const key = generate();
      try {
        await vault.create(key, prompt);
      } catch {
        key.fill(0);
        return "failed";
      }
      open(key);
      return "created";
    },

    async unlock(prompt: string) {
      if (status !== "locked") return;
      try {
        const key = await vault.read(prompt);
        if (key) open(key);
        else set("lost");
      } catch {
        // Refused or cancelled: still locked, and it can be tried again.
      }
    },

    /** A touch or key press: it keeps the key open, unless it came too late. */
    touch() {
      if (status !== "unlocked") return;
      if (expired()) lock();
      else lastUsed = now();
    },

    /** This key was revoked: it goes from the device, and the app starts over at creating one (ADR 0031). */
    async forget() {
      secret?.fill(0);
      secret = null;
      await vault.remove();
      set("none");
    },

    /** The clock alone, for timers and coming back from the background. */
    check() {
      if (status === "unlocked" && expired()) lock();
    },

    /** The key for signing now, or null when locked. */
    secretKey() {
      this.check();
      return secret;
    },

    /** ADR 0012's important actions: a new authentication even when unlocked, for one use. False when it did not happen. */
    async withFreshAuthentication(prompt: string, use: (key: Uint8Array) => void | Promise<void>) {
      let key: Uint8Array | null;
      try {
        key = await vault.read(prompt);
      } catch {
        return false;
      }
      if (!key) {
        secret?.fill(0);
        secret = null;
        set("lost");
        return false;
      }
      try {
        await use(key);
        return true;
      } finally {
        key.fill(0);
      }
    },
  };
}
