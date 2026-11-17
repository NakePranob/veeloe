import { View } from "react-native";
import { meterLevel } from "./meter-level";
import { radius, useColors } from "./theme";

const FILL = { normal: "accent", near: "orange", full: "red" } as const;

// A thin bar for how much of a limit is used, such as today's Budget. The fill turns orange
// past 80% and red when used up; the words beside it still say so (controller-appearance).
export function Meter({ value, label }: { value: number; label: string }) {
  const colors = useColors();
  const share = Math.min(1, Math.max(0, value));
  return (
    <View role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: "hidden" }}>
      <View style={{ width: `${share * 100}%`, height: "100%", borderRadius: radius.pill, backgroundColor: colors[FILL[meterLevel(value)]] }} />
    </View>
  );
}
