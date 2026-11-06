import { View } from "react-native";
import { barHeight, type Bar } from "../lib/bars";
import { radius, useColors } from "./theme";

/** A row of bars for days in a Budget range; each carries its own words for a screen reader. */
export function Bars({ bars, label, height = 56 }: { bars: Bar[]; label: string; height?: number }) {
  const colors = useColors();
  const max = Math.max(0, ...bars.filter((bar) => bar.known).map((bar) => bar.value));
  return (
    <View role="img" aria-label={label} style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height }}>
      {bars.map((bar) => (
        <View key={bar.key} role="img" aria-label={bar.title} style={{ flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" }}>
          {/* A week has room for fat columns; cap them so a few days still look like bars, not blocks. */}
          <View style={{ width: "70%", maxWidth: 24, height: barHeight(bar, max, height), borderRadius: radius.sm, backgroundColor: colors.accent }} />
        </View>
      ))}
    </View>
  );
}
