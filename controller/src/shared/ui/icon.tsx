import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { icon as sizes, useColors, type Colors } from "./theme";

// One name per meaning, drawn as an SF Symbol on iOS and a Material symbol on
// Android and web: one icon family per platform (expo-native-ui).
const SYMBOLS = {
  check: { ios: "checkmark", android: "check", web: "check" },
  // An Agent is waiting on a person: for an Approval, or an allowlist entry (ADR 0030).
  approval: { ios: "hand.raised.fill", android: "back_hand", web: "back_hand" },
  shield: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" },
  scan: { ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" },
  agent: { ios: "cpu", android: "smart_toy", web: "smart_toy" },
  send: { ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" },
  add: { ios: "plus", android: "add", web: "add" },
  attach: { ios: "paperclip", android: "attach_file", web: "attach_file" },
  disclosure: { ios: "chevron.right", android: "chevron_right", web: "chevron_right" },
  thread: { ios: "rectangle.stack", android: "layers", web: "layers" },
  inbox: { ios: "tray", android: "inbox", web: "inbox" },
  time: { ios: "clock", android: "schedule", web: "schedule" },
  info: { ios: "info.circle", android: "info", web: "info" },
  offline: { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" },
  bell: { ios: "bell", android: "notifications", web: "notifications" },
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  machine: { ios: "desktopcomputer", android: "computer", web: "computer" },
  window: { ios: "macwindow", android: "tab", web: "tab" },
  key: { ios: "key", android: "key", web: "key" },
  lock: { ios: "lock", android: "lock", web: "lock" },
  warning: { ios: "exclamationmark.triangle", android: "warning", web: "warning" },
  done: { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" },
  failed: { ios: "xmark.circle.fill", android: "cancel", web: "cancel" },
  stopped: { ios: "stop.circle", android: "stop_circle", web: "stop_circle" },
  expand: { ios: "chevron.down", android: "expand_more", web: "expand_more" },
  collapse: { ios: "chevron.up", android: "expand_less", web: "expand_less" },
  network: { ios: "globe", android: "public", web: "public" },
  device: { ios: "iphone", android: "smartphone", web: "smartphone" },
  usage: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" },
  trash: { ios: "trash", android: "delete", web: "delete" },
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
