import { Link, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Switch, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { Card } from "./card";
import { HeaderAction } from "./header-action";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { Button } from "./button";
import { column, font, radius, space, type, useColors, type Colors } from "./theme";

interface ScreenProps {
  title: string;
  // Goes on the header's right, such as a save or add action.
  right?: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; variant?: "primary" | "chip" | "ghost" };
  // The one action the screen is for, pinned under the content, clear of the home indicator.
  bottom?: ReactNode;
  children: ReactNode;
}

// A settings-style screen: the platform's header over a scrolling column of sections.
export function Screen({ title, right, bottom, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scroll = (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Room for the keyboard on iOS, so a field near the end of a screen can scroll above it.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={[column, { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }]}
    >
      <Stack.Screen options={{ title }} />
      {right && <HeaderAction {...right} />}
      {children}
    </ScrollView>
  );
  if (!bottom) return scroll;
  return (
    <View style={{ flex: 1 }}>
      {scroll}
      <View style={[column, { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm }]}>{bottom}</View>
    </View>
  );
}

// A titled group of rows on one card; the footer explains what the group means.
export function Section({ title, footer, children }: { title?: string; footer?: string; children?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title && (
        <Text variant="footnote" strong tone="secondary" style={{ paddingHorizontal: 14 }}>
          {title}
        </Text>
      )}
      {children != null && <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>{children}</Card>}
      {footer && (
        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: 14, lineHeight: 18 }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

interface RowProps {
  title: string;
  detail?: string;
  // Short text on the right, such as a count or a state.
  value?: string;
  icon?: IconName;
  // A picture or Character on the left, in place of the icon.
  leading?: ReactNode;
  iconColor?: keyof Colors;
  href?: string;
  onPress?: () => void;
  destructive?: boolean;
  mono?: boolean;
  // A control on the right instead of the value and chevron.
  accessory?: ReactNode;
}

// One line in a section. It opens something when it has an href or onPress.
export function Row({ title, detail, value, icon, leading, iconColor, href, onPress, destructive, mono, accessory }: RowProps) {
  const colors = useColors();
  const body = (pressed: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52, paddingHorizontal: 14, paddingVertical: space.md, backgroundColor: pressed ? colors.chipPressed : "transparent" }}>
      {leading ?? (icon && <Icon name={icon} size="md" color={iconColor ?? (destructive ? "red" : "label")} />)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text mono={mono} strong={destructive} tone={destructive ? "danger" : "label"} variant="subheadline" selectable={!href && !onPress}>
          {title}
        </Text>
        {detail && (
          <Text variant="caption" tone="secondary" selectable={!href && !onPress}>
            {detail}
          </Text>
        )}
      </View>
      {value && (
        <Text variant="subheadline" tone="secondary" numberOfLines={1} style={{ flexShrink: 1, maxWidth: "45%" }}>
          {value}
        </Text>
      )}
      {accessory}
      {href && <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />}
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
  if (onPress) {
    return (
      <Pressable role="button" onPress={onPress}>
        {({ pressed }) => body(pressed)}
      </Pressable>
    );
  }
  return body(false);
}

// A Row with a switch: for a setting that is simply on or off (controller-prototype's ToggleRow).
export function ToggleRow({ title, detail, value, onChange, icon, mono }: { title: string; detail?: string; value: boolean; onChange: (value: boolean) => void; icon?: IconName; mono?: boolean }) {
  const colors = useColors();
  return <Row title={title} detail={detail} icon={icon} mono={mono} accessory={<Switch aria-label={title} value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} />} />;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  footer?: string;
  multiline?: boolean;
  mono?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  // A button inside the field, for adding the typed value to a list in one line.
  action?: { label: string; onPress: () => void; disabled?: boolean };
}

// The label sits inside the field, on the surface a step lighter than the card.
export function Field({ label, value, onChangeText, placeholder, footer, multiline, mono, keyboardType, secure, action }: FieldProps) {
  const colors = useColors();
  return (
    <View style={{ gap: space.xs, paddingTop: space.xs, paddingHorizontal: 6, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingLeft: 14, paddingRight: action ? space.xs : 14, paddingVertical: 7, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="secondary">
            {label}
          </Text>
          <TextInput
            aria-label={label}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.tertiaryLabel}
            multiline={multiline}
            keyboardType={keyboardType}
            secureTextEntry={secure}
            autoCapitalize={mono ? "none" : "sentences"}
            autoCorrect={!mono}
            onSubmitEditing={action && !action.disabled ? action.onPress : undefined}
            style={[
              type.body,
              { minHeight: multiline ? 72 : 24, padding: 0, color: colors.label, textAlignVertical: multiline ? "top" : "center" },
              mono && { fontFamily: font.mono, fontSize: 14 },
            ]}
          />
        </View>
        {action && <Button label={action.label} variant="primary" onPress={action.onPress} disabled={action.disabled} />}
      </View>
      {footer && (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.sm }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

// For a list with nothing in it: what it is for and what to do first.
export function Empty({ icon, title, detail, action }: { icon: IconName; title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: space.sm, padding: space.xl }}>
      <Icon name={icon} size="xl" color="tertiaryLabel" />
      <Text variant="headline" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {detail && (
        <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
          {detail}
        </Text>
      )}
      {action}
    </View>
  );
}

// A short rule the Member should not miss, on the screen's grey rather than a card.
export function Note({ icon = "info", iconColor = "secondaryLabel", children }: { icon?: IconName; iconColor?: keyof Colors; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.sm }}>
      <Icon name={icon} size="sm" color={iconColor} />
      <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
