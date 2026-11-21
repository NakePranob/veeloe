import { Pressable, View } from "react-native";
import { useOnCard } from "./surface";
import { Text } from "./text";
import { font, radius, space, useColors, type Colors } from "./theme";

interface Props {
  label: string;
  // status: a dot and a word, such as a Machine online. mono: a model or file name.
  // count: a number of hidden or waiting things. choice: one of several, pressable.
  tone?: "status" | "mono" | "count" | "choice";
  // The dot's colour for a status chip.
  dot?: keyof Colors;
  // A count that needs a person now is orange; the rest are grey.
  urgent?: boolean;
  selected?: boolean;
  onPress?: () => void;
}

// A small pill: a status, a name, a count, or one choice among several.
export function Chip({ label, tone = "status", dot, urgent, selected, onPress }: Props) {
  const colors = useColors();
  const grey = useOnCard() ? colors.surface : colors.chip;
  if (tone === "count") {
    return (
      <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: urgent ? colors.orange : grey }}>
        <Text variant="caption" strong style={{ color: urgent ? colors.onOrange : colors.secondaryLabel, fontVariant: ["tabular-nums"] }}>
          {label}
        </Text>
      </View>
    );
  }
  const body = (pressed: boolean) => {
    const on = tone === "choice" && selected;
    return (
      <View
        style={{
          minHeight: tone === "choice" ? 36 : 28,
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: on ? colors.accent : pressed ? colors.chipPressed : grey,
        }}
      >
        {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors[dot] }} />}
        <Text variant={tone === "mono" ? "caption" : "footnote"} strong={tone !== "mono"} mono={tone === "mono"} style={[on && { color: colors.onAccent }, tone === "mono" && { fontFamily: font.mono }]}>
          {label}
        </Text>
      </View>
    );
  };
  if (!onPress) return body(false);
  return (
    <Pressable role="button" aria-pressed={tone === "choice" ? !!selected : undefined} onPress={onPress} hitSlop={space.xs}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
