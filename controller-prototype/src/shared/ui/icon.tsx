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
  add: { ios: "plus", android: "add", web: "add" },
  more: { ios: "ellipsis", android: "more_horiz", web: "more_horiz" },
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  machine: { ios: "desktopcomputer", android: "computer", web: "computer" },
  agent: { ios: "cpu", android: "smart_toy", web: "smart_toy" },
  device: { ios: "iphone", android: "smartphone", web: "smartphone" },
  member: { ios: "person", android: "person", web: "person" },
  members: { ios: "person.2", android: "group", web: "group" },
  key: { ios: "key", android: "key", web: "key" },
  lock: { ios: "lock", android: "lock", web: "lock" },
  shield: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" },
  network: { ios: "globe", android: "public", web: "public" },
  list: { ios: "list.bullet", android: "list", web: "list" },
  file: { ios: "doc", android: "description", web: "description" },
  attach: { ios: "paperclip", android: "attach_file", web: "attach_file" },
  download: { ios: "arrow.down.circle", android: "download", web: "download" },
  usage: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" },
  bell: { ios: "bell", android: "notifications", web: "notifications" },
  logs: { ios: "text.alignleft", android: "subject", web: "subject" },
  schedule: { ios: "calendar", android: "calendar_month", web: "calendar_month" },
  idle: { ios: "moon", android: "bedtime", web: "bedtime" },
  watch: { ios: "eye", android: "visibility", web: "visibility" },
  thread: { ios: "rectangle.stack", android: "layers", web: "layers" },
  skill: { ios: "book", android: "menu_book", web: "menu_book" },
  connector: { ios: "powerplug", android: "power", web: "power" },
  library: { ios: "books.vertical", android: "library_books", web: "library_books" },
  project: { ios: "folder", android: "folder", web: "folder" },
  branch: { ios: "arrow.triangle.branch", android: "account_tree", web: "account_tree" },
  channel: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" },
  blueprint: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" },
  ask: { ios: "questionmark.bubble", android: "contact_support", web: "contact_support" },
  play: { ios: "play.fill", android: "play_arrow", web: "play_arrow" },
  restart: { ios: "arrow.clockwise", android: "refresh", web: "refresh" },
  trash: { ios: "trash", android: "delete", web: "delete" },
  demo: { ios: "wand.and.stars", android: "science", web: "science" },
  card: { ios: "creditcard", android: "credit_card", web: "credit_card" },
  mail: { ios: "envelope", android: "mail", web: "mail" },
  link: { ios: "link", android: "link", web: "link" },
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
