import { getRandomValues } from "expo-crypto";

// Hermes has no WebCrypto, and @noble reads its randomness from here (ADR 0012).
const scope = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!scope.crypto?.getRandomValues) scope.crypto = { ...scope.crypto, getRandomValues };
