import { View } from "react-native";
import { Text } from "./text";
import { useColors, type Colors } from "./theme";

// A small round status mark beside words that say the same thing (online, offline).
export function Dot({ color = "green", size = 8 }: { color?: keyof Colors; size?: number }) {
  const colors = useColors();
  return <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[color] }} />;
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
