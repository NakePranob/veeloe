import { Color } from "expo-router";
import { useColorScheme, useWindowDimensions, type ColorValue } from "react-native";

// Web has no semantic colours, so it takes the values iOS publishes for each mode.
const web = {
  light: {
    label: "#000000",
    secondaryLabel: "#3C3C4399",
    tertiaryLabel: "#3C3C434D",
    background: "#FFFFFF",
    secondaryBackground: "#F2F2F7",
    tertiaryBackground: "#FFFFFF",
    separator: "#3C3C434A",
    fill: "#7676801F",
    blue: "#007AFF",
    orange: "#FF9500",
    green: "#34C759",
    red: "#FF3B30",
  },
  dark: {
    label: "#FFFFFF",
    secondaryLabel: "#EBEBF599",
    tertiaryLabel: "#EBEBF54D",
    background: "#000000",
    secondaryBackground: "#1C1C1E",
    tertiaryBackground: "#2C2C2E",
    separator: "#54545899",
    fill: "#7676803D",
    blue: "#0A84FF",
    orange: "#FF9F0A",
    green: "#30D158",
    red: "#FF453A",
  },
};

export type Colors = Record<keyof typeof web.light, ColorValue>;

// On a phone these resolve on the device and follow light, dark and contrast settings.
const ios: Colors = {
  label: Color.ios.label,
  secondaryLabel: Color.ios.secondaryLabel,
  tertiaryLabel: Color.ios.tertiaryLabel,
  background: Color.ios.systemBackground,
  secondaryBackground: Color.ios.secondarySystemBackground,
  tertiaryBackground: Color.ios.tertiarySystemBackground,
  separator: Color.ios.separator,
  fill: Color.ios.tertiarySystemFill,
  blue: Color.ios.systemBlue,
  orange: Color.ios.systemOrange,
  green: Color.ios.systemGreen,
  red: Color.ios.systemRed,
};

// Material 3 has no orange or green, so state keeps iOS's.
const android: Colors = {
  label: Color.android.dynamic.onSurface,
  secondaryLabel: Color.android.dynamic.onSurfaceVariant,
  tertiaryLabel: Color.android.dynamic.outline,
  background: Color.android.dynamic.surface,
  secondaryBackground: Color.android.dynamic.surfaceContainer,
  tertiaryBackground: Color.android.dynamic.surfaceContainerHigh,
  separator: Color.android.dynamic.outlineVariant,
  fill: Color.android.dynamic.surfaceContainerHighest,
  blue: Color.android.dynamic.primary,
  orange: web.light.orange,
  green: web.light.green,
  red: Color.android.dynamic.error,
};

// Text on a tinted surface, such as the Member's bubble, stays white in both modes.
export const onTint = "#FFFFFF";

export function useColors(): Colors {
  // Read on every platform: Android re-renders through it when the theme flips.
  const scheme = useColorScheme();
  if (process.env.EXPO_OS === "ios") return ios;
  if (process.env.EXPO_OS === "android") return android;
  return web[scheme === "dark" ? "dark" : "light"];
}

// The navigation theme does colour maths on its values, so it gets plain hex.
export function useNavigationColors() {
  return web[useColorScheme() === "dark" ? "dark" : "light"];
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Pair every radius but a capsule with borderCurve "continuous", Apple's squircle.
export const radius = { sm: 8, md: 12, lg: 18 };

// Apple's text styles. System fonts carry Thai on every platform.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700" },
  headline: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 17 },
  subheadline: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
} as const;

export const mono = process.env.EXPO_OS === "ios" ? "Menlo" : process.env.EXPO_OS === "android" ? "monospace" : "ui-monospace, Menlo, monospace";

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
