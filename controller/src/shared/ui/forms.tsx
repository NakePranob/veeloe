import { Link, Stack } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { Card } from "./card";
import { HeaderAction } from "./header-action";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { column, radius, space, type, useColors, type Colors } from "./theme";

interface ScreenProps {
  title: string;
  // Goes on the header's right, such as a save or add action.
  right?: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName };
  children: ReactNode;
}

// A settings-style screen: the platform's header over a scrolling column of sections.
export function Screen({ title, right, children }: ScreenProps) {
  return (
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
}

// A titled group of rows on one card; the footer explains what the group means.
export function Section({ title, footer, children }: { title?: string; footer?: string; children?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title && (
        <Text variant="footnote" strong tone="secondary" style={{ paddingHorizontal: space.sm }}>
          {title}
        </Text>
      )}
      {children != null && <Card style={{ padding: space.sm, gap: 0 }}>{children}</Card>}
      {footer && (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.sm }}>
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
  iconColor?: keyof Colors;
  href?: string;
  onPress?: () => void;
  destructive?: boolean;
  mono?: boolean;
  // A control on the right instead of the value and chevron.
  accessory?: ReactNode;
}

// One line in a section. It opens something when it has an href or onPress.
export function Row({ title, detail, value, icon, iconColor, href, onPress, destructive, mono, accessory }: RowProps) {
  const colors = useColors();
  const body = (pressed: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44, paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: pressed ? colors.chip : "transparent" }}>
      {icon && <Icon name={icon} size="md" color={iconColor ?? (destructive ? "red" : "secondaryLabel")} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text mono={mono} selectable={!href && !onPress} style={destructive ? { color: colors.red } : undefined}>
          {title}
        </Text>
        {detail && (
          <Text variant="footnote" tone="secondary" selectable={!href && !onPress}>
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
      {href && <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />}
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
}

export function Field({ label, value, onChangeText, placeholder, footer, multiline, mono, keyboardType, secure }: FieldProps) {
  const colors = useColors();
  return (
    <View style={{ gap: space.xs, padding: space.sm }}>
      <Text variant="footnote" tone="secondary">
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
        style={[
          type.body,
          { minHeight: multiline ? 88 : 40, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.fill, color: colors.label, textAlignVertical: multiline ? "top" : "center" },
          mono && { fontFamily: "monospace" },
        ]}
      />
      {footer && (
        <Text variant="footnote" tone="secondary">
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
