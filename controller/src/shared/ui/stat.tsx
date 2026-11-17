import { View } from "react-native";
import { Text } from "./text";
import { font, radius, space, useColors } from "./theme";

// One number with its unit and what it counts, such as free disk space. Several sit in a row.
export function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.card }}>
      <Text selectable style={{ fontFamily: font.display, fontSize: 20, fontVariant: ["tabular-nums"] }}>
        {value}
        {unit ? <Text style={{ fontFamily: font.display, fontSize: 13 }}>{` ${unit}`}</Text> : null}
      </Text>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}
