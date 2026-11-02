import { View } from "react-native";
import { radius, useColors } from "./theme";

// A thin bar for how much of a limit is used, such as today's Budget. The ink fills a grey
// track; a warning is an icon beside the words, not a different colour here.
export function Meter({ value, label }: { value: number; label: string }) {
  const colors = useColors();
  const share = Math.min(1, Math.max(0, value));
  return (
    <View role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.fill, overflow: "hidden" }}>
      <View style={{ width: `${share * 100}%`, height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent }} />
    </View>
  );
}
