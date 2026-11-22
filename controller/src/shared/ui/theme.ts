import { Easing, useColorScheme, useWindowDimensions } from "react-native";

// Shipped with the app (fonts.ts loads them), so text never waits on the network. One family
// per weight, since Android cannot pick a weight inside one family. Anuphan carries Latin as
// well as Thai, and React Native falls back to one family only, so it sets all running text.
// Space Grotesk is for Latin-only numbers and names.
export const font = {
  regular: "Anuphan_400Regular",
  medium: "Anuphan_500Medium",
  semibold: "Anuphan_600SemiBold",
  bold: "Anuphan_700Bold",
  display: "SpaceGrotesk_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

// The redesign canvas's "Design system" board. A white screen with grey cards on it,
// and nothing outlined. Hue is for state and the Agent's Character only:
// orange means a person is needed now, and nothing else.
const light = {
  background: "#ffffff",
  // A group of rows sits on a grey card with no shadow.
  card: "#f3f4f6",
  // What floats, or a field or icon tile inside a card: white, a step up from the card.
  surface: "#ffffff",
  // A quiet pill: one grey that reads on the white screen and on a grey card alike.
  chip: "#f3f4f6",
  chipPressed: "#e5e7eb",
  // A code span or block on the white screen.
  fill: "#f3f4f6",
  // The empty part of a Meter.
  track: "#e5e7eb",
  separator: "#11111114",
  // The soft shadow on the ground under a floating Character.
  ground: "#0f152052",
  label: "#111111",
  secondaryLabel: "#5c5c5c",
  // Body text on a card or a pill, a step softer than the label.
  bodyLabel: "#3a3a3a",
  // Placeholders and disabled words: still quieter than secondary, but 3:1 on white and on the card.
  tertiaryLabel: "#80868f",
  // A link in running text.
  link: "#7e66cc",
  // The accent is the ink itself.
  accent: "#111111",
  onAccent: "#ffffff",
  orange: "#ff7a2f",
  // Words on an orange badge.
  onOrange: "#ffffff",
  blue: "#4c93cc",
  green: "#2e8b57",
  red: "#d92d20",
  // Red that reads as text on the screen and on a card.
  redText: "#b42318",
  // A card that says something failed, or that a person is needed.
  redSoft: "#fef3f2",
  orangeSoft: "#fff4e5",
};

export type Colors = typeof light;

// Not inverted from light: the ink turns white, and what floats is lighter than
// the card in place of a shadow, which does not show on a dark screen.
const dark: Colors = {
  background: "#0e0f12",
  card: "#1c1e23",
  surface: "#2a2d34",
  chip: "#2a2d34",
  chipPressed: "#34373f",
  fill: "#1c1e23",
  track: "#2c2f36",
  separator: "#ffffff12",
  ground: "#000000bf",
  label: "#f5f6f7",
  secondaryLabel: "#9ba0a8",
  bodyLabel: "#c9ccd2",
  tertiaryLabel: "#9ca3af",
  link: "#b9a6ff",
  accent: "#f5f6f7",
  onAccent: "#0e0f12",
  orange: "#ff7a2f",
  onOrange: "#ffffff",
  blue: "#6ab0e8",
  green: "#3fb37a",
  red: "#f04438",
  redText: "#ff6b5e",
  redSoft: "#2a1715",
  orangeSoft: "#2b1d12",
};

// A card on the screen has no shadow. Only what floats over content does, such as
// the composer or a floating button.
const shadows = {
  light: {
    card: "0 0 0 0 rgba(0, 0, 0, 0)",
    raised: "0 4px 16px 0 rgba(17, 17, 17, 0.08)",
    floating: "0 6px 16px 0 rgba(17, 17, 17, 0.18)",
  },
  dark: {
    card: "0 0 0 0 rgba(0, 0, 0, 0)",
    raised: "0 4px 16px 0 rgba(0, 0, 0, 0.40)",
    floating: "0 6px 16px 0 rgba(0, 0, 0, 0.50)",
  },
};

// A QR code is dark on light in either theme, which is what cameras read.
export const qrInk = { dark: "#000000", light: "#ffffff" };

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useShadows() {
  return shadows[useColorScheme() === "dark" ? "dark" : "light"];
}

// xxs: between a title and its detail line. smd: a dot and its words, a heading and its card.
// inset: how far a row's content sits in from its card's edge, and the board's step between blocks.
export const space = { xxs: 2, xs: 4, smd: 6, sm: 8, md: 12, inset: 14, lg: 16, xl: 24 };

// Pair every radius but a pill with borderCurve "continuous".
// sm: an icon tile in a row. md: a field, a picker tile or a card nested in a card. card: a group of rows. lg: a large card.
export const radius = { sm: 10, md: 16, card: 20, lg: 24, pill: 999 };

// row: the least height of one line in a section.
export const size = { row: 52 };

// dim: a control or row that cannot act right now, and a text link while pressed. retired: what is away or gone (an offline Machine, a deleted Agent).
export const opacity = { dim: 0.45, retired: 0.6 };

// The board's scale. Weight comes from the family (see fonts.ts), never fontWeight,
// which iOS would synthesize over a bundled font.
// largeTitle: an Agent's name on its stage. title: the one heading of a centred step or a form (lock, pairing).
// callout: body text on a card or a notice, a step under subheadline. caption2: tab, bar and picker labels.
export const type = {
  largeTitle: { fontSize: 30, lineHeight: 36, fontFamily: font.bold, letterSpacing: -0.9 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: font.bold, letterSpacing: -0.4 },
  // A large number on a tile or a total: Space Grotesk, with room above so iOS does not clip it.
  figure: { fontSize: 30, lineHeight: 36, fontFamily: font.display, letterSpacing: -0.6, fontVariant: ["tabular-nums"] },
  headline: { fontSize: 17, fontFamily: font.bold },
  body: { fontSize: 16, fontFamily: font.regular, lineHeight: 24 },
  subheadline: { fontSize: 15, fontFamily: font.regular },
  callout: { fontSize: 14, lineHeight: 21, fontFamily: font.regular },
  footnote: { fontSize: 13, lineHeight: 20, fontFamily: font.regular },
  caption: { fontSize: 12, lineHeight: 18, fontFamily: font.regular },
  caption2: { fontSize: 11, lineHeight: 14, fontFamily: font.regular },
} as const;

// Motion: short, eased out, never bouncy for routine changes.
export const motion = {
  duration: { micro: 80, quick: 150, fast: 250, medium: 350 },
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  // How far a pressed control sinks.
  press: 0.97,
};

// Icon sizes: xs beside a caption, sm beside a footnote, md beside a headline,
// lg for a composer action, xl for an empty state.
export const icon = { xs: 12, sm: 16, md: 20, lg: 32, xl: 44 };

// Content stops growing past a readable measure on a computer.
export const column = { width: "100%", maxWidth: 720, alignSelf: "center" } as const;

// From this width the inbox and the open Task sit side by side, as Mail does on an iPad.
export const SIDEBAR_WIDTH = 360;

export function useSplit() {
  return useWindowDimensions().width >= 960;
}
