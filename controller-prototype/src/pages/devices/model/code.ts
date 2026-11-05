// A stand-in for the new device's public key, which a real one makes and shows as a QR.
export const newKey = (random = Math.random) => Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join("");
