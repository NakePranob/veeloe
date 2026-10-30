import { DropdownMenu, DropdownMenuItem, Host, RNHostView, Text } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable } from "react-native";
import { chosenLabel, SelectChip, type SelectProps } from "./select-chip";
import { space, useColors } from "./theme";

// Our chip opens a Material dropdown menu anchored to it.
export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <Host matchContents seedColor={colors.accent}>
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable role="button" aria-label={label} aria-expanded={open} onPress={() => setOpen(true)} hitSlop={space.xs}>
              {({ pressed }) => <SelectChip text={chosenLabel({ value, options })} pressed={pressed} />}
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <DropdownMenuItem.Text>
                <Text>{option.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
