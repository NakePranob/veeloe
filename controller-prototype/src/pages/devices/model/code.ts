// A stand-in for the secret in the QR this device shows, which a real one makes with 256 random bits.
export const newKey = (random = Math.random) => Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join("");
