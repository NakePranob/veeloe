import { Link, Stack, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Switch, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { Card } from "./card";
import { HeaderAction } from "./header-action";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { Button } from "./button";
import { OnCard, useOnCard } from "./surface";
import { column, font, opacity, radius, size, space, type, useColors, type Colors } from "./theme";

interface ScreenProps {
  title: string;
  // A line under the title in the header, such as whose page this is ("Nim · 4 entries").
  subtitle?: string;
  // Goes on the header's right, such as a save or add action.
  right?: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; variant?: "primary" | "chip" | "ghost" };
  // The one action the screen is for, pinned under the content, clear of the home indicator.
  bottom?: ReactNode;
  children: ReactNode;
}

// A settings-style screen: the platform's header over a scrolling column of sections.
export function Screen({ title, subtitle, right, bottom, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scroll = (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Room for the keyboard on iOS, so a field near the end of a screen can scroll above it.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={[column, { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xl, paddingBottom: space.xl * 2 }]}
    >
      <Stack.Screen options={{ title, ...(subtitle != null && { headerTitle: () => <HeaderTitle title={title} subtitle={subtitle} /> }) }} />
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

// The title with a quieter line under it, as the platform's header draws a subtitle.
function HeaderTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text variant="headline" numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

/** Fields and pills inside draw white, as on a card: for a tinted stage, where grey would sink into the colour. */
export function OnTint({ children }: { children: ReactNode }) {
  return <OnCard.Provider value>{children}</OnCard.Provider>;
}

// A titled group of rows on one card; the footer explains what the group means.
export function Section({ title, footer, children }: { title?: string; footer?: string; children?: ReactNode }) {
  return (
    <View style={{ gap: space.smd }}>
      {title && (
        <Text variant="footnote" strong tone="secondary" style={{ paddingHorizontal: space.inset }}>
          {title}
        </Text>
      )}
      {children != null && <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>{children}</Card>}
      {footer && (
        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: space.inset }}>
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
  href?: Href;
  // A long press on a row with an href, such as a Task row opening its details.
  onLongPress?: () => void;
  onPress?: () => void;
  destructive?: boolean;
  mono?: boolean;
  // A control on the right instead of the value and chevron.
  accessory?: ReactNode;
  // Shown faded and inert, for a setting that cannot change right now (its Machine is offline).
  disabled?: boolean;
  // The board's create row: an ink circle with a plus in place of the icon, and the title in bold.
  add?: boolean;
  // For a row that opens choices under it (Select): whether they are showing, and which one is chosen.
  expanded?: boolean;
  selected?: boolean;
}

// One line in a section. It opens something when it has an href or onPress.
export function Row({ title, detail, value, icon, leading, iconColor, href, onLongPress, onPress, destructive, mono, accessory, disabled, add, expanded, selected }: RowProps) {
  const colors = useColors();
  const body = (pressed: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.row, paddingHorizontal: space.inset, paddingVertical: space.md, backgroundColor: pressed ? colors.chipPressed : "transparent" }}>
      {add ? (
        <View aria-hidden style={{ width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent }}>
          <Icon name="add" size="md" color="onAccent" weight="semibold" />
        </View>
      ) : (
        (leading ?? (icon && <Icon name={icon} size="md" color={iconColor ?? (destructive ? "red" : "label")} />))
      )}
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text mono={mono} strong={destructive || add} tone={destructive ? "danger" : "label"} variant="subheadline" selectable={!href && !onPress}>
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
      {href && !disabled && <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />}
    </View>
  );
  const role = href ? "link" : onPress ? "button" : undefined;
  const state = { "aria-expanded": expanded, "aria-selected": selected };
  // Still the control it would be, so a screen reader says it is there and dimmed.
  if (disabled)
    return (
      <Pressable role={role} disabled aria-disabled accessibilityState={{ disabled: true }} {...state} style={{ opacity: opacity.dim }}>
        {body(false)}
      </Pressable>
    );
  // Link's Slot drops a Pressable style function on web, so the look lives on an inner View.
  if (href) {
    return (
      <Link href={href} asChild>
        <Pressable role="link" onLongPress={onLongPress} {...state}>
          {({ pressed }) => body(pressed)}
        </Pressable>
      </Link>
    );
  }
  if (onPress) {
    return (
      <Pressable role="button" onPress={onPress} {...state}>
        {({ pressed }) => body(pressed)}
      </Pressable>
    );
  }
  return body(false);
}

// A Row with a switch: for a setting that is simply on or off.
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
  // The label is only read aloud: a one-line pill, such as an add box or a search box, where the placeholder says enough.
  bare?: boolean;
  icon?: IconName;
  // Faded and read-only, for a value that cannot change right now.
  disabled?: boolean;
}

// The label sits inside the field, on the surface a step lighter than the card.
export function Field({ label, value, onChangeText, placeholder, footer, multiline, mono, keyboardType, secure, action, bare, icon, disabled }: FieldProps) {
  const colors = useColors();
  const inCard = useOnCard();
  return (
    // In a Section's card the box is white with a little inset; on the screen it is one grey box.
    <View style={{ gap: space.xs, opacity: disabled ? opacity.dim : 1, ...(inCard ? { paddingTop: space.xs, paddingHorizontal: space.smd, paddingBottom: space.smd } : null) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: bare ? 44 : size.row,
          paddingLeft: space.inset,
          paddingRight: action ? space.xs : space.inset,
          paddingVertical: bare ? space.xs : 7,
          borderRadius: bare ? radius.pill : radius.md,
          borderCurve: "continuous",
          backgroundColor: inCard ? colors.surface : colors.card,
        }}
      >
        {icon && <Icon name={icon} size="sm" color="secondaryLabel" />}
        <View style={{ flex: 1, gap: space.xxs }}>
          {!bare && (
            <Text variant="caption" tone="secondary">
              {label}
            </Text>
          )}
          <TextInput
            aria-label={label}
            aria-disabled={disabled}
            editable={!disabled}
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
            style={[type.body, { minHeight: multiline ? 72 : 24, padding: 0, color: colors.label, textAlignVertical: multiline ? "top" : "center" }, mono && { fontFamily: font.mono, fontSize: 14 }]}
          />
        </View>
        {action && <Button label={action.label} variant="primary" size={bare ? "small" : undefined} onPress={action.onPress} disabled={action.disabled} />}
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
    // flex: 1 centres it in the room its list leaves, which grows to the screen (Screen, the inbox).
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl }}>
      {/* The icon in the title's colour, both faint. */}
      <View style={{ opacity: 0.3 }}>
        <Icon name={icon} size="xxl" color="label" />
      </View>
      <Text variant="headline" style={{ textAlign: "center", opacity: 0.3 }}>
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
// plain: a caption paragraph under the content where there is no Section whose footer it could be.
// warning: a soft orange box with an icon, for something a person should act on.
// offline: the line that says the Machine must be online for this, with the orange offline mark.
// Otherwise a line with an icon in front.
export function Note({ icon = "info", iconColor = "secondaryLabel", tone, children }: { icon?: IconName; iconColor?: keyof Colors; tone?: "plain" | "warning" | "offline"; children: ReactNode }) {
  const colors = useColors();
  if (tone === "plain")
    return (
      <Text variant="caption" tone="secondary" style={{ paddingHorizontal: space.inset }}>
        {children}
      </Text>
    );
  const box = tone === "warning";
  const offline = tone === "offline";
  return (
    <View
      style={[
        { flexDirection: "row", gap: space.sm, paddingHorizontal: space.sm },
        box && { paddingHorizontal: space.inset, paddingVertical: space.md, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: colors.orangeSoft },
      ]}
    >
      <Icon name={box ? "warning" : offline ? "offline" : icon} size="sm" color={box || offline ? "orange" : iconColor} />
      <Text variant="footnote" tone={box ? "body" : "secondary"} style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
