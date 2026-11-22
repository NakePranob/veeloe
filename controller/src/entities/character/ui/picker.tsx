import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, useColorScheme, View } from "react-native";
import { OnTint, radius, space, Text, useColors } from "../../../shared/ui";
import { tint } from "../model/look";

// The pieces of the Character editor that are painted in the Agent's own colour. They live with the
// entity, since a page takes no colour of its own (ADR 0072).

// How far the Agent's colour is lifted toward the screen: a soft stage, a stronger chosen tile.
const STAGE = { light: 0.72, dark: 0.82 };
const PICKED = { light: 0.5, dark: 0.7 };
// The Mood being previewed, on the white card under the stage (AgentCharacter board: tint .6).
const PREVIEWED = { light: 0.6, dark: 0.7 };

/** The colour lifted toward the screen's own, so it stays soft on white and on the dark screen alike. */
function useTint(color: string, amount: { light: number; dark: number }) {
  const colors = useColors();
  return useColorScheme() === "dark" ? mixToward(color, colors.card, amount.dark) : tint(color, amount.light);
}

function mixToward(hex: string, to: string, k: number) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, "0");
  return "#" + ch(a >> 16, b >> 16) + ch((a >> 8) & 255, (b >> 8) & 255) + ch(a & 255, b & 255);
}

/**
 * A stage in a soft tint of the Agent's colour, for the head. Rounded on its own, or, with bleed, the top
 * of a Screen: edge to edge under a header of the same tint, rounded only below (the Agent board).
 */
// gap: between what the stage holds; the Agent board packs its head, name and pills at 6.
export function Stage({ color, bleed, gap = space.md, children }: { color: string; bleed?: boolean; gap?: number; children: ReactNode }) {
  const background = useTint(color, STAGE);
  if (!bleed) return <View style={{ alignItems: "center", gap, padding: space.lg, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: background }}>{children}</View>;
  return (
    // The Screen pads its column by space.lg and starts space.sm down; the stage cancels both.
    <View
      style={{
        alignItems: "center",
        gap,
        marginHorizontal: -space.lg,
        marginTop: -space.sm,
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: space.lg,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
        borderCurve: "continuous",
        backgroundColor: background,
      }}
    >
      <Stack.Screen options={{ headerStyle: { backgroundColor: background }, headerShadowVisible: false, headerTransparent: false }} />
      {/* What a pull past the top uncovers is the same tint, not the white screen. */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: "100%", height: 1000, backgroundColor: background }} />
      <OnTint>{children}</OnTint>
    </View>
  );
}

/**
 * A card in a soft tint of the Agent's colour, for what that Agent is asking. solid: the open Approval's
 * card, the Agent's colour itself with the board's radius 30; dark keeps the tint, since ink words would
 * not read on the solid colour there. Either way, fields and pills on it draw white.
 */
export function AgentCard({ color, solid, children }: { color: string; solid?: boolean; children: ReactNode }) {
  const soft = useTint(color, STAGE);
  const dark = useColorScheme() === "dark";
  if (!solid) return <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: soft }}>{children}</View>;
  return (
    <View style={{ padding: 18, borderRadius: 30, borderCurve: "continuous", backgroundColor: dark ? soft : color }}>
      <OnTint>{children}</OnTint>
    </View>
  );
}

/** One option to pick: the head wearing it and its name. The chosen one fills with the Agent's colour, with no ring. */
export function LookTile({ color, label, name, selected, onPress, children }: { color: string; label: string; name: string; selected: boolean; onPress: () => void; children: ReactNode }) {
  const colors = useColors();
  const picked = useTint(color, PICKED);
  return (
    <Pressable role="button" aria-label={label} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            // Five to a row with their gaps still fit a 375pt screen.
            width: 62,
            alignItems: "center",
            gap: space.xs,
            paddingVertical: space.sm,
            paddingHorizontal: space.xs,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: selected ? picked : pressed ? colors.chipPressed : colors.card,
          }}
        >
          {children}
          {/* Android's Thai is wider than iOS's: a long name shrinks a little before it is cut. */}
          <Text variant="caption2" strong tone="body" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {name}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** One colour to pick. The chosen one is ringed in ink, a gap of screen between, so it reads on any colour in either theme. */
export function Swatch({ color, label, selected, onPress }: { color: string; label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    // 30 plus 7 on each side clears the 44pt target. The gap is the card it sits on (the board).
    <Pressable role="button" aria-label={label} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress} hitSlop={7}>
      <View style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: color, boxShadow: selected ? `0 0 0 2px ${colors.card}, 0 0 0 4px ${colors.label}` : undefined }} />
    </Pressable>
  );
}

/** One Mood to preview the head in; the one shown fills with the Agent's colour. */
export function MoodTile({ color, label, selected, onPress, children }: { color: string; label: string; selected: boolean; onPress: () => void; children: ReactNode }) {
  const colors = useColors();
  const previewed = useTint(color, PREVIEWED);
  return (
    <Pressable role="button" aria-label={label} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress}>
      {({ pressed }) => (
        <View style={{ width: 54, alignItems: "center", gap: space.xxs, paddingVertical: space.xs, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: selected ? previewed : pressed ? colors.chipPressed : "transparent" }}>
          {children}
          <Text variant="caption2" tone={selected ? "label" : "secondary"} strong={selected} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
