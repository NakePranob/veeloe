import { View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { radius, space, useColors } from "./theme";

export interface SelectProps<T extends string> {
  // What is being chosen, for a screen reader: the chip itself shows only the chosen option.
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export const chosenLabel = <T extends string>({ value, options }: Pick<SelectProps<T>, "value" | "options">) =>
  options.find((option) => option.value === value)?.label ?? "";

// What a Select looks like on every platform: the chosen option on a chip, with
// the up-and-down chevron that says a menu opens. Only the menu is the platform's.
export function SelectChip({ text, pressed }: { text: string; pressed?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        // 36 like a Button; each platform's trigger brings the target up to 44.
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingLeft: space.lg,
        paddingRight: space.md,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.chipPressed : colors.chip,
      }}
    >
      <Text variant="subheadline" strong numberOfLines={1}>
        {text}
      </Text>
      <Icon name="choose" size="xs" weight="semibold" />
    </View>
  );
}
