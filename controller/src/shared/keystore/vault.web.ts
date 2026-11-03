import type { Vault } from "./session";

// ADR 0012: on web the key sits in IndexedDB and a passkey is the app's gate, not a
// lock on the key. There is no server to trust, so the assertion is not verified.
const DB = "veeloe-keystore";
const STORE = "key";
const RECORD = "controller";

type Stored = { secret: Uint8Array; credentialId: ArrayBuffer };

function request<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode) {
  return new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const action = run(opening.result.transaction(STORE, mode).objectStore(STORE));
      action.onerror = () => reject(action.error);
      action.onsuccess = () => resolve(action.result);
    };
  });
}

const load = () => request<Stored | undefined>((store) => store.get(RECORD), "readonly");
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export const vault: Vault = {
  isSupported: async () => (await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) === true,
  hasKey: async () => (await load()) !== undefined,

  async create(secret) {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: "Veeloe" },
        user: { id: random(16), name: "Veeloe", displayName: "Veeloe" },
        pubKeyCredParams: [-8, -7, -257].map((alg) => ({ type: "public-key" as const, alg })),
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("No passkey was created");
    await request((store) => store.put({ secret: secret.slice(), credentialId: credential.rawId } satisfies Stored, RECORD), "readwrite");
  },

  async read() {
    const stored = await load();
    if (!stored) return null;
    const assertion = await navigator.credentials.get({
      publicKey: { challenge: random(32), userVerification: "required", allowCredentials: [{ type: "public-key", id: stored.credentialId }] },
    });
    if (!assertion) throw new Error("The passkey was refused");
    return stored.secret;
  },
};
