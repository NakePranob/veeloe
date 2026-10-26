import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { space, type Colors } from "./theme";

interface Props {
  // The icon carries the state's colour, so the words can stay readable grey or black.
  icon?: IconName;
  iconColor?: keyof Colors;
  variant?: "subheadline" | "footnote" | "caption";
  tone?: "label" | "secondary";
  strong?: boolean;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// A small icon and a line of text: a status, an expiry, an outcome.
export function Label({ icon, iconColor = "secondaryLabel", variant = "footnote", tone = "secondary", strong, numberOfLines, style, children }: Props) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: space.xs }, style]}>
      {icon && <Icon name={icon} size={variant === "caption" ? "xs" : "sm"} color={iconColor} />}
      <Text variant={variant} tone={tone} strong={strong} numberOfLines={numberOfLines} style={{ flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}
