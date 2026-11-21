import { View } from "react-native";
import { barHeight, type Bar } from "../lib/bars";
import { Text } from "./text";
import { useColors } from "./theme";

// One line of 11pt caption and the 6pt gap to its bar, above and below the bars when the chart has words.
const LINE = 14;
const GAP = 6;

interface Props {
  bars: Bar[];
  label: string;
  // The whole chart's height, words included.
  height?: number;
  // A word under each bar, such as its weekday, from the caller (ADR 0065); the last, today, is bold.
  ticks?: string[];
  // Today's value, written above today's bar.
  peak?: string;
}

/** A row of bars for days in a Budget range; each carries its own words for a screen reader. */
export function Bars({ bars, label, height = 56, ticks, peak }: Props) {
  const colors = useColors();
  const max = Math.max(0, ...bars.filter((bar) => bar.known).map((bar) => bar.value));
  const worded = !!ticks || peak !== undefined;
  const room = worded ? height - 2 * (LINE + GAP) : height;
  const last = bars.length - 1;
  return (
    <View role="img" aria-label={label} style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, height }}>
      {bars.map((bar, i) => (
        <View key={bar.key} role="img" aria-label={bar.title} style={{ flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end", gap: worded ? GAP : 0 }}>
          {/* Only today's value shows; the others keep their line so every bar starts from the same floor. */}
          {worded && (
            <Text variant="caption" strong numberOfLines={1} style={{ fontSize: 11, lineHeight: LINE, opacity: i === last && peak !== undefined ? 1 : 0 }}>
              {i === last ? (peak ?? "") : ""}
            </Text>
          )}
          {/* A week has room for fat columns; cap them so a few days still look like bars, not blocks. */}
          {/* Today, the last bar, is solid; the days before it are faded, as on the Usage board. */}
          <View style={{ width: "100%", maxWidth: 30, height: barHeight(bar, max, room), borderRadius: 8, backgroundColor: colors.accent, opacity: i === last ? 1 : 0.28 }} />
          {worded && (
            <Text variant="caption" tone={i === last ? "label" : "secondary"} strong={i === last} numberOfLines={1} style={{ fontSize: 11, lineHeight: LINE }}>
              {ticks?.[i] ?? ""}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
