import type { ReactNode, Ref } from "react";
import { TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Text } from "./text";
import { radius, space, type, useColors } from "./theme";

// The pieces of a conversation that need colour, so the Task page lays them out without picking any (ADR 0072).

/** A message the Member sent: an ink bubble on the right, as in Messages. Queued, it is faded until it goes. */
export function Bubble({ text, queued, note }: { text: string; queued?: boolean; note?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", gap: space.xs }}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm + 2, borderRadius: 22, borderBottomRightRadius: 6, borderCurve: "continuous", backgroundColor: colors.accent, opacity: queued ? 0.55 : 1 }}>
        <Text selectable style={{ color: colors.onAccent }}>
          {text}
        </Text>
      </View>
      {note}
    </View>
  );
}

/** A bare text field for a composer: no box of its own, since it sits inside one. */
export function Input({ style, ref, ...props }: TextInputProps & { ref?: Ref<TextInputInstance> }) {
  const colors = useColors();
  return <TextInput ref={ref} placeholderTextColor={colors.tertiaryLabel} {...props} style={[type.body, { color: colors.label }, style]} />;
}

/** How far a Fade reaches. */
export const FADE = space.xl + space.sm;

/** Fades scrolling content into the screen's colour above whatever sits under it. Zero height: it draws upward. */
export function Fade() {
  const colors = useColors();
  return (
    <View style={{ height: 0, pointerEvents: "none" }}>
      <Svg width="100%" height={FADE} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.background} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

const RING = 32;
const STROKE = 3;
const R = (RING - STROKE) / 2;
const LENGTH = 2 * Math.PI * R;
const RING_TONE = { ok: "green", warn: "orange", full: "red" } as const;

/** A small ring for how full something is, with a dot of the same colour in the middle. */
export function Ring({ ratio, tone }: { ratio: number; tone: keyof typeof RING_TONE }) {
  const colors = useColors();
  const color = colors[RING_TONE[tone]];
  return (
    <View style={{ width: RING, height: RING, alignItems: "center", justifyContent: "center" }}>
      <Svg width={RING} height={RING}>
        <Circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={colors.track} strokeWidth={STROKE} />
        <Circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${LENGTH} ${LENGTH}`} strokeDashoffset={LENGTH * (1 - Math.min(1, Math.max(0, ratio)))} rotation={-90} origin={`${RING / 2}, ${RING / 2}`} />
      </Svg>
      <View style={{ position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

/** A quiet block set off by the fill, for a quote or a code sample. */
export function Inset({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.fill }}>{children}</View>;
}
