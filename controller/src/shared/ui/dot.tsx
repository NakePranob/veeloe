import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./text";
import { radius, space, useColors, type Colors } from "./theme";

// A small round status mark beside words that say the same thing (online, offline).
export function Dot({ color = "green", size = 8 }: { color?: keyof Colors; size?: number }) {
  const colors = useColors();
  return <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[color] }} />;
}

// Six dots in two columns on a small white card: the handle a row is dragged by (three lines would read as a menu).
export function Grip() {
  const colors = useColors();
  return (
    <View aria-hidden style={{ flexDirection: "row", gap: 4, padding: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface }}>
      {[0, 1].map((column) => (
        <View key={column} style={{ gap: 4 }}>
          <Dot color="tertiaryLabel" size={4} />
          <Dot color="tertiaryLabel" size={4} />
          <Dot color="tertiaryLabel" size={4} />
        </View>
      ))}
    </View>
  );
}

// A dot and the caption that says the same thing: a tile's last line, an Agent's state under its name.
// The words stay readable ink or grey; the dot carries the colour. Words are one caption line; anything
// else (words with a link in them) is laid out after the dot as it is.
export function DotLabel({ color, tone = "body", strong, children }: { color?: keyof Colors; tone?: "label" | "body" | "secondary" | "danger"; strong?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.smd }}>
      {color && <Dot color={color} size={7} />}
      {typeof children === "string" ? (
        <Text variant="caption" tone={tone} strong={strong} numberOfLines={1} style={{ flexShrink: 1 }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

// A numbered step: the number in white on an ink circle (AddMachine's steps).
export function StepNumber({ n }: { n: number }) {
  const colors = useColors();
  return (
    <View aria-hidden style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent }}>
      <Text variant="footnote" strong style={{ color: colors.onAccent }}>
        {n}
      </Text>
    </View>
  );
}
