import { Text as RNText, type TextProps } from "react-native";
import { font, radius, space, type, useColors } from "./theme";

// Running text is label or secondary. Orange and green fall below 4.5:1 at text sizes,
// so state colour goes on an icon beside the words; red text uses `danger`.
const TONE = { label: "label", body: "bodyLabel", secondary: "secondaryLabel", danger: "redText", link: "link" } as const;

interface Props extends TextProps {
  variant?: keyof typeof type;
  tone?: keyof typeof TONE;
  strong?: boolean;
  mono?: boolean;
  // A block of code or plain text that must not be read as anything else, on the fill.
  code?: boolean;
}

export function Text({ variant = "body", tone = "label", strong, mono, code, style, ...props }: Props) {
  const colors = useColors();
  // A weight is a family of its own (theme.ts `font`), so strong and mono swap the family.
  // Headings are bold already, so strong leaves them be.
  const heading = variant === "headline" || variant === "largeTitle" || variant === "figure";
  const family = mono || code ? (strong ? font.monoMedium : font.mono) : strong && !heading ? font.semibold : undefined;
  return <RNText {...props} style={[type[variant], { color: colors[TONE[tone]] }, family && { fontFamily: family }, code && { backgroundColor: colors.fill, padding: space.sm, borderRadius: radius.sm }, style]} />;
}
