import { Easing, useColorScheme, useWindowDimensions } from "react-native";

// Monochrome with a cool, faintly blue cast, the same on every platform. The
// screen is a light grey so white cards stand out; nothing is outlined.
// The only hues are state, on icons: orange means a person is needed now.
const light = {
  background: "#f3f5f8",
  surface: "#ffffff",
  chip: "#eef1f5",
  chipPressed: "#e2e7ee",
  fill: "#e8ecf2",
  separator: "#0f172a14",
  // The soft shadow on the ground under a floating Character.
  ground: "#0f152052",
  label: "#0f1520",
  secondaryLabel: "#5b6472",
  tertiaryLabel: "#8a93a1",
  // The accent is the ink itself.
  accent: "#0f1520",
  onAccent: "#ffffff",
  orange: "#ff9500",
  green: "#34c759",
  red: "#ff3b30",
};

export type Colors = typeof light;

const dark: Colors = {
  background: "#0e1116",
  surface: "#181c23",
  chip: "#232833",
  chipPressed: "#2c323e",
  fill: "#222731",
  separator: "#ffffff12",
  ground: "#000000bf",
  label: "#f5f7fa",
  secondaryLabel: "#a3acb9",
  tertiaryLabel: "#6b7480",
  accent: "#f5f7fa",
  onAccent: "#0e1116",
  orange: "#ff9f0a",
  green: "#30d158",
  red: "#ff453a",
};

// Soft, wide, faintly blue shadows lift a card off the grey; never an edge line.
const shadows = {
  light: {
    card: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 8px 24px 0 rgba(15, 23, 42, 0.06)",
    raised: "0 2px 6px 0 rgba(15, 23, 42, 0.05), 0 12px 32px 0 rgba(15, 23, 42, 0.09)",
  },
  dark: {
    card: "0 1px 2px 0 rgba(0, 0, 0, 0.30), 0 8px 24px 0 rgba(0, 0, 0, 0.35)",
    raised: "0 2px 6px 0 rgba(0, 0, 0, 0.35), 0 12px 32px 0 rgba(0, 0, 0, 0.45)",
  },
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useShadows() {
  return shadows[useColorScheme() === "dark" ? "dark" : "light"];
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Pair every radius but a pill with borderCurve "continuous". Cards share one
// generous radius so they sit with the pills inside them, as the composer does.
export const radius = { sm: 8, lg: 18, card: 22, pill: 999 };

// Apple's sizes; headings at medium weight, never bold. System fonts carry Thai on every platform.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "500" },
  headline: { fontSize: 17, fontWeight: "500" },
  body: { fontSize: 17 },
  subheadline: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
} as const;

export const mono = process.env.EXPO_OS === "ios" ? "Menlo" : process.env.EXPO_OS === "android" ? "monospace" : "ui-monospace, Menlo, monospace";

// Motion: short, eased out, never bouncy for routine changes.
export const motion = {
  duration: { micro: 80, quick: 150, fast: 250, medium: 350 },
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  // How far a pressed control sinks.
  press: 0.97,
};

// Icon sizes: xs beside a caption, sm beside a footnote, md beside a headline,
// lg for a composer action, xl for an empty state.
export const icon = { xs: 12, sm: 15, md: 18, lg: 32, xl: 44 };

// Content stops growing past a readable measure on a computer.
export const column = { width: "100%", maxWidth: 720, alignSelf: "center" } as const;

// From this width the inbox and the open Task sit side by side, as Mail does on an iPad.
export const SIDEBAR_WIDTH = 360;

export function useSplit() {
  return useWindowDimensions().width >= 960;
}
