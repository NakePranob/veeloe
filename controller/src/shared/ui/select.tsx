import { type ReactNode, useState } from "react";
// biome-ignore lint/correctness/useReactNativePlatformComponents: used only behind the EXPO_OS === "ios" check in press()
import { ActionSheetIOS } from "react-native";
import { DotLabel } from "./dot";
import { Row } from "./forms";
import { Icon } from "./icon";
import { Text } from "./text";
import type { Colors } from "./theme";

/** One choice: the value the screen keeps, and the words it shows. */
// disabled: shown but not choosable (a Machine that is offline). dot: a state dot before the chosen value in the row;
// the system sheet takes words only, so there a disabled option is greyed out instead.
export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean; dot?: keyof Colors };

/**
 * One row that says what is chosen. On iOS it opens the system's own sheet of choices, the menu a
 * control opens being the platform's; elsewhere the choices open under it, ticked. The label names
 * the choice, so a screen reader reads "Agent, every Agent" rather than just a value.
 */
// cancel: the words on the sheet's Cancel row, from the screen's own words. leading: what sits before the label, as a Row's.
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  cancel,
  leading,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  cancel: string;
  leading?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const pick = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };
  function press() {
    if (process.env.EXPO_OS !== "ios") return setOpen((was) => !was);
    // ponytail: the sheet marks no tick on the chosen one; a native context menu with ticks needs @expo/ui.
    ActionSheetIOS.showActionSheetWithOptions(
      { title: label, options: [...options.map((option) => option.label), cancel], cancelButtonIndex: options.length, disabledButtonIndices: options.flatMap((option, i) => (option.disabled ? [i] : [])) },
      (index) => {
        if (index < options.length && !options[index].disabled) pick(options[index].value);
      },
    );
  }
  return (
    <>
      <Row
        title={label}
        leading={leading}
        value={chosen?.dot ? undefined : chosen?.label}
        disabled={disabled}
        onPress={press}
        expanded={process.env.EXPO_OS === "ios" ? undefined : open}
        accessory={
          <>
            {chosen?.dot && (
              <DotLabel color={chosen.dot}>
                <Text variant="subheadline" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {chosen.label}
                </Text>
              </DotLabel>
            )}
            <Icon name={open ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />
          </>
        }
      />
      {open &&
        options.map((option) => (
          <Row
            key={option.value}
            title={option.label}
            disabled={option.disabled}
            onPress={() => pick(option.value)}
            selected={option.value === value}
            accessory={option.value === value ? <Icon name="check" size="md" color="label" weight="semibold" /> : undefined}
          />
        ))}
    </>
  );
}
