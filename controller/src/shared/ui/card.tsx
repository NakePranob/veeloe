import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { OnCard } from "./surface";
import { radius, space, useColors, useShadows } from "./theme";

interface Props {
  // raised: floats over content, as the composer does: the surface colour with a shadow.
  raised?: boolean;
  // danger: a failed Turn (soft red). warning: a person is needed (soft orange).
  // surface: white without a shadow, for a real card nested in a grey one (a form, a code box, a nested list).
  tone?: "danger" | "warning" | "surface";
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// A grey card on the white screen, with no shadow and never an outline. Raised, it is
// a step lighter than the card and casts a shadow, for what floats over content.
export function Card({ raised, tone, style, children }: Props) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <View
      style={[
        {
          gap: space.sm,
          padding: space.lg,
          borderRadius: radius.card,
          borderCurve: "continuous",
          backgroundColor: tone === "danger" ? colors.redSoft : tone === "warning" ? colors.orangeSoft : raised || tone === "surface" ? colors.surface : colors.card,
        },
        raised && { boxShadow: shadows.raised },
        style,
      ]}
    >
      {/* Only the plain grey card turns what is on it white; a white or tinted card keeps it grey. */}
      <OnCard.Provider value={!raised && !tone}>{children}</OnCard.Provider>
    </View>
  );
}
