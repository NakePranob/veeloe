// The short code both screens show for a new Controller's key, like Signal's safety number (ADR 0031).
// ponytail: 16 symbols x 4 is 65,536 codes; the real one derives more bits from the public key.
const SYMBOLS = ["🐙", "🦊", "🐳", "🌵", "🍄", "🚀", "🎲", "🔔", "🌙", "🍋", "🧊", "🎈", "🐝", "🪁", "🧲", "🍉"];

export function shortCode(key: string) {
  // FNV-1a, so the same key always gives the same code.
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return [0, 4, 8, 12].map((shift) => SYMBOLS[(hash >>> shift) & 15]).join(" ");
}

export const newKey = (random = Math.random) => Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join("");
