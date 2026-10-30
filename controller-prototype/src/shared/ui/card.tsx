import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space, useColors, useShadows } from "./theme";

interface Props {
  // raised: floats over content, as the composer does.
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// A white surface lifted off the grey screen by a soft shadow; never an outline.
// Use it for the one thing on a screen that stands on its own.
export function Card({ raised, style, children }: Props) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <View
      style={[
        { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: colors.surface, boxShadow: raised ? shadows.raised : shadows.card },
        style,
      ]}
    >
      {children}
    </View>
  );
}
