import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { icon as sizes, useColors, type Colors } from "./theme";

// One name per meaning, drawn as an SF Symbol on iOS and a Material symbol on
// Android: one icon family per platform (expo-native-ui).
const SYMBOLS = {
  check: { ios: "checkmark", android: "check" },
  // An Agent is waiting on a person: for an Approval, or an allowlist entry (ADR 0030).
  approval: { ios: "hand.raised.fill", android: "back_hand" },
  shield: { ios: "checkmark.shield", android: "verified_user" },
  scan: { ios: "qrcode.viewfinder", android: "qr_code_scanner" },
  agent: { ios: "face.smiling", android: "smart_toy" },
  send: { ios: "arrow.up", android: "arrow_upward" },
  add: { ios: "plus", android: "add" },
  // Every item of something, such as all of an Agent's Tasks.
  list: { ios: "list.bullet", android: "list" },
  attach: { ios: "paperclip", android: "attach_file" },
  disclosure: { ios: "chevron.right", android: "chevron_right" },
  thread: { ios: "rectangle.stack", android: "layers" },
  inbox: { ios: "tray", android: "inbox" },
  time: { ios: "clock", android: "schedule" },
  info: { ios: "info.circle", android: "info" },
  offline: { ios: "wifi.slash", android: "wifi_off" },
  bell: { ios: "bell", android: "notifications" },
  settings: { ios: "gearshape", android: "settings" },
  machine: { ios: "desktopcomputer", android: "computer" },
  window: { ios: "macwindow", android: "tab" },
  key: { ios: "key", android: "key" },
  lock: { ios: "lock", android: "lock" },
  warning: { ios: "exclamationmark.triangle", android: "warning" },
  done: { ios: "checkmark.circle.fill", android: "check_circle" },
  failed: { ios: "xmark.circle.fill", android: "cancel" },
  stopped: { ios: "stop.circle", android: "stop_circle" },
  expand: { ios: "chevron.down", android: "expand_more" },
  collapse: { ios: "chevron.up", android: "expand_less" },
  network: { ios: "globe", android: "public" },
  folder: { ios: "folder", android: "folder" },
  device: { ios: "iphone", android: "smartphone" },
  usage: { ios: "chart.bar", android: "bar_chart" },
  trash: { ios: "trash", android: "delete" },
  memory: { ios: "brain.head.profile", android: "psychology" },
  // A git repo an Agent may use (issue #32).
  refresh: { ios: "arrow.clockwise", android: "refresh" },
  edit: { ios: "pencil", android: "edit" },
  // Draw a new random look.
  shuffle: { ios: "dice", android: "casino" },
  // An Agent's Character, as a head.
  character: { ios: "face.smiling", android: "smart_toy" },
  file: { ios: "doc.text", android: "description" },
  share: { ios: "square.and.arrow.up", android: "ios_share" },
  faceId: { ios: "faceid", android: "fingerprint" },
  storage: { ios: "externaldrive", android: "storage" },
  sliders: { ios: "slider.horizontal.3", android: "tune" },
  copy: { ios: "doc.on.doc", android: "content_copy" },
  qr: { ios: "qrcode", android: "qr_code" },
  terminal: { ios: "apple.terminal", android: "terminal" },
  search: { ios: "magnifyingglass", android: "search" },
  more: { ios: "ellipsis", android: "more_horiz" },
  external: { ios: "arrow.up.right.square", android: "open_in_new" },
  branch: { ios: "arrow.triangle.branch", android: "fork_right" },
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
