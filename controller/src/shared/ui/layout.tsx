import { Link } from "expo-router";
import { Children, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { column, radius, space, useColors, type Colors } from "./theme";

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

/** The big grey disc with one icon that heads a whole-screen message (another tab, storage, a new key). small: the 36pt one beside a point in a list. */
export function IconDisc({ icon, color = "label", small }: { icon: IconName; color?: keyof Colors; small?: boolean }) {
  const colors = useColors();
  const side = small ? 36 : 112;
  return (
    <View aria-hidden style={[{ width: side, height: side, borderRadius: side / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.card }, !small && { alignSelf: "center", marginBottom: space.sm }]}>
      <Icon name={icon} size={small ? "sm" : "xl"} color={color} />
    </View>
  );
}

/** A form step's actions pinned at its foot, clear of the home indicator; each takes an equal share of the width. */
export function FooterBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, ...column }}>
      {Children.map(children, (child) => child && <View style={{ flex: 1 }}>{child}</View>)}
    </View>
  );
}

/** One step of a flow, centred: something on top (a spinner, an IconDisc), its heading and body, then anything under them; the footer is pinned below. */
export function CenteredStep({ top, heading, body, footer, children }: { top: ReactNode; heading: string; body: string; footer?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl + space.md }}>
        {top}
        <Text variant="title" role="heading" style={{ textAlign: "center" }}>
          {heading}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {body}
        </Text>
        {children}
      </View>
      {footer}
    </View>
  );
}
