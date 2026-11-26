/** One day in a chart. `known` is false when the Machine had nothing for that day, which is a gap, not a zero. */
export type Bar = { key: string; title: string; value: number; known: boolean };

/** How much of the tallest bar a value fills. Nothing known, nothing above zero, nothing drawn. */
export function barShare(value: number, max: number) {
  return max > 0 && value > 0 ? Math.min(1, value / max) : 0;
}

/** A known day always shows at least a sliver, so a small day is not mistaken for a gap. */
export function barHeight(bar: Pick<Bar, "value" | "known">, max: number, height: number) {
  if (!bar.known) return 0;
  const share = barShare(bar.value, max);
  return share === 0 ? 0 : Math.max(2, share * height);
}
