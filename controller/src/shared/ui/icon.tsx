import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { icon as sizes, useColors, type Colors } from "./theme";

// One name per meaning, drawn as an SF Symbol on iOS and a Material symbol on
// Android and web: one icon family per platform (expo-native-ui).
const SYMBOLS = {
  check: { ios: "checkmark", android: "check", web: "check" },
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  machine: { ios: "desktopcomputer", android: "computer", web: "computer" },
  window: { ios: "macwindow", android: "tab", web: "tab" },
  key: { ios: "key", android: "key", web: "key" },
  lock: { ios: "lock", android: "lock", web: "lock" },
  warning: { ios: "exclamationmark.triangle", android: "warning", web: "warning" },
} as const satisfies Record<string, SymbolViewProps["name"]>;

export type IconName = keyof typeof SYMBOLS;

export const iosSymbol = (name: IconName) => SYMBOLS[name].ios;

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
