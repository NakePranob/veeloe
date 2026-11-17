import type { ReactNode } from "react";
import { Pressable, useColorScheme, View } from "react-native";
import { radius, space, Text, useColors } from "../../../shared/ui";
import { tint } from "../model/look";

// The pieces of the Character editor that are painted in the Agent's own colour. They live with the
// entity, since a page takes no colour of its own (ADR 0072).

// How far the Agent's colour is lifted toward the screen: a soft stage, a stronger chosen tile.
const STAGE = { light: 0.72, dark: 0.82 };
const PICKED = { light: 0.5, dark: 0.7 };

/** The colour lifted toward the screen's own, so it stays soft on white and on the dark screen alike. */
function useTint(color: string, amount: { light: number; dark: number }) {
  const colors = useColors();
  return useColorScheme() === "dark" ? mixToward(color, colors.card, amount.dark) : tint(color, amount.light);
}

function mixToward(hex: string, to: string, k: number) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return "#" + ch(a >> 16, b >> 16) + ch((a >> 8) & 255, (b >> 8) & 255) + ch(a & 255, b & 255);
}

/** A rounded stage in a soft tint of the Agent's colour, for the head being edited. */
export function Stage({ color, children }: { color: string; children: ReactNode }) {
  return <View style={{ alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: useTint(color, STAGE) }}>{children}</View>;
}

/** A card in a soft tint of the Agent's colour, for what that Agent is asking, such as an Approval. */
export function AgentCard({ color, children }: { color: string; children: ReactNode }) {
  return <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: useTint(color, STAGE) }}>{children}</View>;
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
          <Text variant="caption" strong={selected} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
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
    // 34 plus 5 on each side clears the 44pt target.
    <Pressable role="button" aria-label={label} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress} hitSlop={5}>
      <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: color, boxShadow: selected ? `0 0 0 3px ${colors.background}, 0 0 0 5px ${colors.label}` : undefined }} />
    </Pressable>
  );
}
