import { Link } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space, useColors } from "./theme";

// Pages and widgets lay things out with View, but take colour only from here (controller-theme).

/** Something is on its way: a small spinner in the quiet text colour. */
export function Spinner({ size = "small" }: { size?: "small" | "large" }) {
  const colors = useColors();
  return <ActivityIndicator size={size} color={colors.secondaryLabel} />;
}

/** A whole screen of one message and its action, centred, outside the navigation stack (lock, another tab). */
export function Centered({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl, backgroundColor: colors.background }}>{children}</View>;
}

interface TapProps {
  href?: string;
  onPress?: () => void;
  // Kept highlighted, such as the Task open beside the inbox.
  selected?: boolean;
  // Layout only: padding, gap, direction. The background is the Tap's.
  style?: StyleProp<ViewStyle>;
  children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}

/** A rounded area that highlights while pressed, for a row richer than Row (a Character and several lines). */
export function Tap({ href, onPress, selected, style, children }: TapProps) {
  const colors = useColors();
  const body = (pressed: boolean) => (
    <View style={[{ borderRadius: radius.md, borderCurve: "continuous", backgroundColor: pressed ? colors.chipPressed : selected ? colors.chip : "transparent" }, style]}>
      {typeof children === "function" ? children({ pressed }) : children}
    </View>
  );
  // Link's Slot drops a Pressable style function on web, so the look lives on an inner View.
  if (href) {
    return (
      <Link href={href as never} asChild>
        <Pressable role="link">{({ pressed }) => body(pressed)}</Pressable>
      </Link>
    );
  }
  return (
    <Pressable role="button" aria-selected={selected} onPress={onPress}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
