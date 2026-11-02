import { createStore } from "../../../shared/lib";

// ponytail: the Machine's screen is simulated. The real Runtime shows a QR holding its public
// key and a one-time code; the Controller scans it and the keys swap without the Hub (ADR 0006).
type Status = "open" | "used" | "replaced";
interface Offer {
  code: string;
  status: Status;
}

const offers = createStore<Offer[]>([]);
export const useOffers = offers.use;

// No 0/O or 1/I, so a code read off a screen is typed right.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");
const pretty = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

// The Machine shows one code at a time; asking for another retires the one before.
export function issueCode(random = Math.random) {
  const raw = Array.from({ length: 8 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  offers.set((all) => [...all.map((offer): Offer => (offer.status === "open" ? { ...offer, status: "replaced" } : offer)), { code: pretty(raw), status: "open" }]);
  return pretty(raw);
}

export function currentCode() {
  return offers.get().find((offer) => offer.status === "open")?.code;
}

// What a typed or scanned code would do, without spending it: a code is only spent once the
// Owner has authenticated.
export function checkCode(input: string): "ok" | "wrong" | "used" | "replaced" {
  const offer = offers.get().find((candidate) => normalize(candidate.code) === normalize(input));
  if (!offer) return "wrong";
  return offer.status === "open" ? "ok" : offer.status;
}

export function spendCode(input: string) {
  offers.set((all) => all.map((offer): Offer => (normalize(offer.code) === normalize(input) ? { ...offer, status: "used" } : offer)));
}

export const REFUSAL = {
  wrong: "รหัสนี้ไม่ใช่รหัสที่ Machine ไหนแสดง ตรวจตัวอักษรอีกครั้ง",
  used: "รหัสนี้ใช้ไปแล้ว รหัสใช้ได้ครั้งเดียว ให้ Machine แสดงรหัสใหม่",
  replaced: "Machine แสดงรหัสใหม่แล้ว รหัสนี้ใช้ไม่ได้ ใช้รหัสที่อยู่บนจอตอนนี้",
} as const;
