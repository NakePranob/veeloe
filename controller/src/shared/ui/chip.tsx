import { Pressable, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { useOnCard } from "./surface";
import { Text } from "./text";
import { radius, space, useColors, type Colors } from "./theme";

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
  // A small icon before the words, in place of a dot (the clock on a countdown).
  icon?: IconName;
  onPress?: () => void;
  // What a screen reader says when the label alone does not (a remove chip: "Remove notes.md").
  "aria-label"?: string;
}

// A small pill: a status, a name, a count, or one choice among several.
export function Chip({ label, tone = "status", dot, urgent, selected, icon, onPress, "aria-label": ariaLabel }: Props) {
  const colors = useColors();
  const grey = useOnCard() ? colors.surface : colors.chip;
  if (tone === "count") {
    return (
      <View aria-label={ariaLabel} style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: urgent ? colors.orange : grey }}>
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
        aria-label={onPress ? undefined : ariaLabel}
        style={{
          minHeight: tone === "choice" ? 36 : 28,
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          flexDirection: "row",
          alignItems: "center",
          gap: space.smd,
          backgroundColor: on ? colors.accent : pressed ? colors.chipPressed : grey,
        }}
      >
        {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors[dot] }} />}
        {icon && <Icon name={icon} size="xs" color="bodyLabel" />}
        <Text variant={tone === "mono" ? "caption" : "footnote"} strong={tone !== "mono"} mono={tone === "mono"} style={on ? { color: colors.onAccent } : undefined}>
          {label}
        </Text>
      </View>
    );
  };
  if (!onPress) return body(false);
  // The pill is 28 or 36pt high; the press reaches 44.
  const slop = (44 - (tone === "choice" ? 36 : 28)) / 2;
  return (
    <Pressable role="button" aria-label={ariaLabel} aria-pressed={tone === "choice" ? !!selected : undefined} onPress={onPress} hitSlop={{ top: slop, bottom: slop, left: space.xs, right: space.xs }}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
