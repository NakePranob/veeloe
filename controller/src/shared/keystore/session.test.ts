import { expect, test } from "bun:test";
import { createKeySession, IDLE_LIMIT_MS, type Vault } from "./session";

function setup({ supported = true, stored = false } = {}) {
  const state = { time: 1000, hasKey: stored, read: "ok" as "ok" | "refuse" | "lost", reads: 0, failCreate: false };
  const vault: Vault = {
    isSupported: async () => supported,
    hasKey: async () => state.hasKey,
    create: async () => {
      if (state.failCreate) throw new Error("refused");
      state.hasKey = true;
    },
    read: async () => {
      state.reads++;
      if (state.read === "refuse") throw new Error("cancelled");
      return state.read === "lost" ? null : new Uint8Array(32).fill(7);
    },
    remove: async () => {
      state.hasKey = false;
    },
  };
  return { state, session: createKeySession({ vault, now: () => state.time, generate: () => new Uint8Array(32).fill(9) }) };
}

async function unlocked() {
  const made = setup({ stored: true });
  await made.session.load();
  await made.session.unlock("p");
  return made;
}

test("a device with no key says none and has no key until asked", async () => {
  const { session } = setup();
  await session.load();
  expect(session.status()).toBe("none");
  expect(session.secretKey()).toBeNull();
});

test("a device that cannot authenticate gets no key", async () => {
  const { session, state } = setup({ supported: false });
  await session.load();
  expect(await session.create("p")).toBe("unsupported");
  expect(state.hasKey).toBe(false);
  expect(session.status()).toBe("none");
});

test("a refused creation leaves no open key", async () => {
  const { session, state } = setup();
  await session.load();
  state.failCreate = true;
  expect(await session.create("p")).toBe("failed");
  expect(session.status()).toBe("none");
});

test("creating opens the key, and a stored key starts locked", async () => {
  const fresh = setup();
  await fresh.session.load();
  expect(await fresh.session.create("p")).toBe("created");
  expect(fresh.session.status()).toBe("unlocked");
  const stored = setup({ stored: true });
  await stored.session.load();
  expect(stored.session.status()).toBe("locked");
  expect(stored.session.secretKey()).toBeNull();
});

test("a cancelled unlock stays locked, keeps the key, and can be tried again", async () => {
  const { session, state } = setup({ stored: true });
  await session.load();
  state.read = "refuse";
  await session.unlock("p");
  expect(session.status()).toBe("locked");
  state.read = "ok";
  await session.unlock("p");
  expect(session.status()).toBe("unlocked");
});

test("a key the OS invalidated is lost, not a new device, and only an explicit create replaces it", async () => {
  const { session, state } = setup({ stored: true });
  await session.load();
  state.read = "lost";
  await session.unlock("p");
  expect(session.status()).toBe("lost");
  expect(session.secretKey()).toBeNull();
  expect(await session.create("p")).toBe("created");
  expect(session.status()).toBe("unlocked");
});

test("past five minutes idle it locks and wipes the secret", async () => {
  const { session, state } = await unlocked();
  const key = session.secretKey()!;
  state.time += IDLE_LIMIT_MS + 1;
  session.check();
  expect(session.status()).toBe("locked");
  expect(session.secretKey()).toBeNull();
  expect([...key].every((byte) => byte === 0)).toBe(true);
});

test("exactly five minutes is not past the limit", async () => {
  const { session, state } = await unlocked();
  state.time += IDLE_LIMIT_MS;
  session.check();
  expect(session.status()).toBe("unlocked");
});

test("use within the limit extends it without asking again", async () => {
  const { session, state } = await unlocked();
  const reads = state.reads;
  for (let n = 0; n < 3; n++) {
    state.time += IDLE_LIMIT_MS - 1;
    session.touch();
  }
  expect(session.status()).toBe("unlocked");
  expect(state.reads).toBe(reads);
});

test("a touch after the limit, as on return from the background, locks instead of extending", async () => {
  const { session, state } = await unlocked();
  state.time += IDLE_LIMIT_MS + 1;
  session.touch();
  expect(session.status()).toBe("locked");
});

test("secretKey cannot outlive the limit even if nothing checked", async () => {
  const { session, state } = await unlocked();
  state.time += IDLE_LIMIT_MS + 1;
  expect(session.secretKey()).toBeNull();
});

test("an important action asks again even when unlocked, and wipes its copy", async () => {
  const { session, state } = await unlocked();
  const reads = state.reads;
  let seen: Uint8Array | undefined;
  expect(await session.withFreshAuthentication("p", (key) => void (seen = key))).toBe(true);
  expect(state.reads).toBe(reads + 1);
  expect([...seen!].every((byte) => byte === 0)).toBe(true);
  expect(session.status()).toBe("unlocked");
});

test("a refused important action does not run and does not lock", async () => {
  const { session, state } = await unlocked();
  state.read = "refuse";
  let ran = false;
  expect(await session.withFreshAuthentication("p", () => void (ran = true))).toBe(false);
  expect(ran).toBe(false);
  expect(session.status()).toBe("unlocked");
});

test("a revoked device forgets its key: none left to read, and back to creating one", async () => {
  const { session, state } = await unlocked();
  const key = session.secretKey()!;
  await session.forget();
  expect(key.every((b) => b === 0)).toBe(true);
  expect(state.hasKey).toBe(false);
  expect(session.status()).toBe("none");
  expect(session.secretKey()).toBeNull();
});

test("an important action on an invalidated key does not run and reports lost", async () => {
  const { session, state } = await unlocked();
  state.read = "lost";
  let ran = false;
  expect(await session.withFreshAuthentication("p", () => void (ran = true))).toBe(false);
  expect(ran).toBe(false);
  expect(session.status()).toBe("lost");
});
