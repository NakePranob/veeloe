import { Pressable, Text as RNText, type TextProps } from "react-native";
import { font, opacity, radius, space, type, useColors } from "./theme";

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
  const heading = variant === "headline" || variant === "largeTitle" || variant === "title" || variant === "figure";
  const family = mono || code ? (strong ? font.monoMedium : font.mono) : strong && !heading ? font.semibold : undefined;
  return <RNText {...props} style={[type[variant], { color: colors[TONE[tone]] }, family && { fontFamily: family }, code && { backgroundColor: colors.fill, padding: space.sm, borderRadius: radius.sm }, style]} />;
}

interface LinkProps {
  label: string;
  onPress: () => void;
  variant?: "caption" | "footnote";
  tone?: keyof typeof TONE;
  strong?: boolean;
  mono?: boolean;
  disabled?: boolean;
  // button: an action written as underlined words (an Approval's other choices); link: it opens a page.
  role?: "link" | "button";
}

/**
 * Underlined words that do something, on their own beside other words (an Approval's "other options",
 * the Machine on an Agent's stage). The press reaches 44pt above and below the line.
 * A link inside a sentence stays a nested Text with onPress, since a Text cannot widen its target.
 */
export function TextLink({ label, onPress, variant = "caption", tone = "label", strong, mono, disabled, role = "link" }: LinkProps) {
  const slop = (44 - type[variant].lineHeight) / 2;
  return (
    <Pressable role={role} aria-disabled={disabled} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={{ top: slop, bottom: slop, left: space.xs, right: space.xs }}>
      {({ pressed }) => (
        <Text variant={variant} tone={tone} strong={strong} mono={mono} numberOfLines={1} style={{ textDecorationLine: "underline", opacity: pressed || disabled ? opacity.dim : 1 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
