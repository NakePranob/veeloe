import { Host, Menu, Picker, RNHostView, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { chosenLabel, SelectChip, type SelectProps } from "./select-chip";
import { useColors } from "./theme";

// Our chip opens a SwiftUI menu, which ticks the chosen option.
export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  const colors = useColors();
  return (
    <Host matchContents seedColor={colors.accent}>
      <Menu
        label={
          <RNHostView matchContents>
            <SelectChip text={chosenLabel({ value, options })} />
          </RNHostView>
        }
        modifiers={[accessibilityLabel(label)]}
      >
        <Picker selection={value} onSelectionChange={(next) => onChange(next as T)} modifiers={[pickerStyle("inline")]}>
          {options.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}
