import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { icon as sizes, useColors, type Colors } from "./theme";

// One name per meaning, drawn as an SF Symbol on iOS and a Material symbol on
// Android and web: one icon family per platform (expo-native-ui).
const SYMBOLS = {
  approval: { ios: "hand.raised.fill", android: "back_hand", web: "back_hand" },
  done: { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" },
  failed: { ios: "xmark.circle.fill", android: "cancel", web: "cancel" },
  stopped: { ios: "stop.circle", android: "stop_circle", web: "stop_circle" },
  // Drawn inside a Button circle, so plain glyphs rather than circled ones.
  stop: { ios: "stop.fill", android: "stop", web: "stop" },
  send: { ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" },
  time: { ios: "clock", android: "schedule", web: "schedule" },
  info: { ios: "info.circle", android: "info", web: "info" },
  inbox: { ios: "tray", android: "inbox", web: "inbox" },
  disclosure: { ios: "chevron.right", android: "chevron_right", web: "chevron_right" },
  expand: { ios: "chevron.down", android: "expand_more", web: "expand_more" },
  collapse: { ios: "chevron.up", android: "expand_less", web: "expand_less" },
  // On a Select's chip: a menu of options opens here.
  choose: { ios: "chevron.up.chevron.down", android: "unfold_more", web: "unfold_more" },
} as const satisfies Record<string, SymbolViewProps["name"]>;

export type IconName = keyof typeof SYMBOLS;

interface Props {
  name: IconName;
  size?: keyof typeof sizes;
  color?: keyof Colors;
  weight?: "regular" | "semibold";
}

// Decorative by default: an icon sits beside words that say the same thing,
// and a control that is only an icon carries its own aria-label.
export function Icon({ name, size = "sm", color = "secondaryLabel", weight }: Props) {
  const colors = useColors();
  return <SymbolView aria-hidden name={SYMBOLS[name]} size={sizes[size]} tintColor={colors[color]} weight={weight} />;
}
