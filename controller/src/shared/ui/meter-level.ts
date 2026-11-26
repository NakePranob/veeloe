// How full a Meter is decides its colour: ink as usual, orange past 80%, red once it is used up.
export type MeterLevel = "normal" | "near" | "full";

export function meterLevel(share: number): MeterLevel {
  if (share >= 1) return "full";
  if (share > 0.8) return "near";
  return "normal";
}
