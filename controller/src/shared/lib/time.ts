import { useEffect, useState } from "react";

const MINUTE = 60_000;

// ponytail: Thai only, like the rest of the copy until the app has a second language.
export function ago(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / MINUTE);
  if (minutes < 1) return "ตอนนี้";
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ชม.`;
  return `${Math.floor(minutes / (24 * 60))} วัน`;
}

export function fromNow(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((at - now) / MINUTE));
  return minutes < 60 ? `${minutes} นาที` : `${Math.floor(minutes / 60)} ชม.`;
}

// The current time, refreshed often enough for "3 นาที" and an Approval's
// expiry to stay true while a screen is open.
export function useNow(every = 15_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
