import { Pressable, ScrollView, View } from "react-native";
import { Chip } from "./chip";
import { Text } from "./text";
import { radius, space, useColors } from "./theme";

export interface Tab<T extends string> {
  value: T;
  label: string;
  // Shown beside the label when given; urgent makes it orange.
  count?: number;
  urgent?: boolean;
}

// Pills in a row, the chosen one in ink. No underline and no track behind them.
export function Tabs<T extends string>({ items, value, onChange }: { items: Tab<T>[]; value: T; onChange: (value: T) => void }) {
  const colors = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} role="tablist" contentContainerStyle={{ gap: 6 }}>
      {items.map((item) => {
        const on = item.value === value;
        return (
          <Pressable key={item.value} role="tab" aria-selected={on} onPress={() => onChange(item.value)} hitSlop={{ top: 4, bottom: 4 }}>
            {({ pressed }) => (
              <View
                style={{
                  height: 36,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: on ? colors.accent : pressed ? colors.chipPressed : colors.chip,
                }}
              >
                <Text variant="subheadline" strong style={on ? { color: colors.onAccent } : undefined}>
                  {item.label}
                </Text>
                {item.count != null && item.count > 0 && <Chip tone="count" label={String(item.count)} urgent={item.urgent} />}
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
