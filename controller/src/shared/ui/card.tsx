import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space, useColors, useShadows } from "./theme";

interface Props {
  // raised: floats over content, as the composer does: the surface colour with a shadow.
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// A grey card on the white screen, with no shadow and never an outline. Raised, it is
// a step lighter than the card and casts a shadow, for what floats over content.
export function Card({ raised, style, children }: Props) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <View
      style={[
        { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: raised ? colors.surface : colors.card },
        raised && { boxShadow: shadows.raised },
        style,
      ]}
    >
      {children}
    </View>
  );
}
