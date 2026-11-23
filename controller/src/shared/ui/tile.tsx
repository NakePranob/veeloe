import { Link, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { OnCard } from "./surface";
import { Text } from "./text";
import { font, radius, space, useColors } from "./theme";

interface Props {
  // On top: an icon in a white circle, or something of the screen's own (a few heads, a caption).
  icon?: IconName;
  top?: ReactNode;
  // The large figure, with a smaller unit a space after it ("2" "/ 3", "40%" "Budget"): words come from the screen's i18n.
  value?: string;
  unit?: string;
  title?: string;
  // The line under it: words, a dot and words, a Meter.
  detail?: ReactNode;
  // A least height pushes the figure to the bottom, so tiles side by side line up; longer words grow the tile.
  height?: number;
  href?: Href;
  onPress?: () => void;
}

// The Workspace and Machine boards' square: a grey card with one figure and what it counts, two to a row.
export function Tile({ icon, top, value, unit, title, detail, height, href, onPress }: Props) {
  const colors = useColors();
  const body = (pressed: boolean) => (
    <View style={{ minHeight: height, flexGrow: 1, gap: space.xxs, padding: space.inset, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: pressed ? colors.chipPressed : colors.card }}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
          <Icon name={icon} size="md" color="label" />
        </View>
      ) : (
        top
      )}
      {value != null && (
        <Text variant="figure" style={height != null && { marginTop: "auto" }}>
          {value}
          {unit ? <Text style={{ fontFamily: font.display, fontSize: 16, color: colors.secondaryLabel }}>{` ${unit}`}</Text> : null}
        </Text>
      )}
      {title && (
        <Text variant="subheadline" strong numberOfLines={1}>
          {title}
        </Text>
      )}
      <OnCard.Provider value>
        {typeof detail === "string" ? (
          <Text variant="caption" tone="body" numberOfLines={1}>
            {detail}
          </Text>
        ) : (
          detail
        )}
      </OnCard.Provider>
    </View>
  );
  const tile = { flex: 1 } as const;
  // Link's Slot drops a Pressable style function on web, so the look lives on an inner View.
  if (href)
    return (
      <Link href={href} asChild>
        <Pressable role="link" style={tile}>
          {({ pressed }) => body(pressed)}
        </Pressable>
      </Link>
    );
  if (onPress)
    return (
      <Pressable role="button" onPress={onPress} style={tile}>
        {({ pressed }) => body(pressed)}
      </Pressable>
    );
  return <View style={tile}>{body(false)}</View>;
}
