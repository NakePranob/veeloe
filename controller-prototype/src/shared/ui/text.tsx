import { Text as RNText, type TextProps } from "react-native";
import { mono as monoFont, type, useColors } from "./theme";

// Text is label or secondary only. Orange, red and green fall below 4.5:1 on
// white at text sizes, so state colour goes on an icon beside the words.
const TONE = { label: "label", secondary: "secondaryLabel" } as const;

interface Props extends TextProps {
  variant?: keyof typeof type;
  tone?: keyof typeof TONE;
  strong?: boolean;
  mono?: boolean;
}

export function Text({ variant = "body", tone = "label", strong, mono, style, ...props }: Props) {
  const colors = useColors();
  return (
    <RNText
      {...props}
      style={[type[variant], { color: colors[TONE[tone]] }, strong && { fontWeight: "500" }, mono && { fontFamily: monoFont }, style]}
    />
  );
}
