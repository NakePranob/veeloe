import { Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "../../../shared/ui";
import type { ContextUsage } from "../model/items";

const SIZE = 32;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The context window as a ring beside Send; tap opens the numbers. */
export function ContextMeter({ usage, onPress }: { usage: ContextUsage | null; onPress: () => void }) {
  const colors = useColors();
  if (!usage || usage.window <= 0) return null;
  const ratio = Math.min(1, Math.max(0, usage.tokens / usage.window));
  const color = usage.tokens >= usage.threshold ? colors.red : ratio >= 0.5 ? colors.orange : colors.green;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${Math.round(ratio * 100)}% context used`} hitSlop={8} onPress={onPress} style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={colors.fill} strokeWidth={STROKE} />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          rotation={-90}
          origin={`${SIZE / 2}, ${SIZE / 2}`}
        />
      </Svg>
      <View style={{ position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </Pressable>
  );
}
