import { View } from "react-native";
import { useColors, type Colors } from "./theme";

// A small round status mark beside words that say the same thing (online, offline).
export function Dot({ color = "green", size = 8 }: { color?: keyof Colors; size?: number }) {
  const colors = useColors();
  return <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[color] }} />;
}
