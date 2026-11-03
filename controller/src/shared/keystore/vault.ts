import { fromBase64url, publicKeyOf, toBase64url } from "@veeloe/protocol";
import * as SecureStore from "expo-secure-store";
import type { Vault } from "./session";

// Biometric items cannot share a keychain service with plain ones (expo-secure-store docs).
const SECRET = "controller-secret";
const SECRET_OPTIONS = { keychainService: "veeloe.controller-secret", keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;
// Public, and readable without authentication: when the secret reads null this tells "invalidated" from "never had one".
const MARKER = "controller-public-key";

const locked = (prompt: string) => ({ ...SECRET_OPTIONS, requireAuthentication: true, authenticationPrompt: prompt });

export const vault: Vault = {
  isSupported: async () => SecureStore.canUseBiometricAuthentication(),
  hasKey: async () => (await SecureStore.getItemAsync(MARKER)) !== null,

  async create(secret, prompt) {
    await SecureStore.deleteItemAsync(SECRET, SECRET_OPTIONS);
    await SecureStore.setItemAsync(SECRET, toBase64url(secret), locked(prompt));
    await SecureStore.setItemAsync(MARKER, toBase64url(publicKeyOf(secret)));
    // iOS does not ask when writing a new item: read it back to prove the key opens.
    if ((await SecureStore.getItemAsync(SECRET, locked(prompt))) === null) throw new Error("The new key does not open");
  },

  async read(prompt) {
    const value = await SecureStore.getItemAsync(SECRET, locked(prompt));
    return value === null ? null : fromBase64url(value);
  },
};
