import { Pressable, View } from "react-native";
import { Chip } from "./chip";
import { Text } from "./text";
import { radius, space, useColors, useShadows } from "./theme";

export interface Tab<T extends string> {
  value: T;
  label: string;
  // Shown beside the label when given; urgent makes it an orange badge.
  count?: number;
  urgent?: boolean;
}

// The Inbox board's segmented control: a grey track, the chosen tab a white pill lifted by a soft
// shadow, the rest plain grey words. Each tab takes an equal share of the width; a 38pt tab takes a 44pt press.
export function Tabs<T extends string>({ items, value, onChange }: { items: Tab<T>[]; value: T; onChange: (value: T) => void }) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <View role="tablist" style={{ flexDirection: "row", gap: space.xxs, padding: space.xs, borderRadius: radius.pill, backgroundColor: colors.card }}>
      {items.map((item) => {
        const on = item.value === value;
        const shown = item.count != null && item.count > 0;
        return (
          <Pressable key={item.value} role="tab" aria-selected={on} onPress={() => onChange(item.value)} hitSlop={(44 - 38) / 2} style={{ flex: 1 }}>
            <View
              style={{
                height: 38,
                borderRadius: radius.pill,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: space.smd,
                backgroundColor: on ? colors.surface : "transparent",
                boxShadow: on ? shadows.raised : undefined,
              }}
            >
              <Text variant="callout" strong numberOfLines={1} tone={on ? "label" : "secondary"}>
                {item.label}
              </Text>
              {shown &&
                (item.urgent ? (
                  <Chip tone="count" urgent label={String(item.count)} />
                ) : (
                  <Text variant="caption" tone="secondary">
                    {item.count}
                  </Text>
                ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
