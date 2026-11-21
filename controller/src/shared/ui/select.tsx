import { useState } from "react";
import { ActionSheetIOS } from "react-native";
import { Row } from "./forms";
import { Icon } from "./icon";

/** One choice: the value the screen keeps, and the words it shows. */
export type SelectOption<T extends string> = { value: T; label: string };

/**
 * One row that says what is chosen. On iOS it opens the system's own sheet of choices, the menu a
 * control opens being the platform's; elsewhere the choices open under it, ticked. The label names
 * the choice, so a screen reader reads "Agent, every Agent" rather than just a value.
 */
// cancel: the words on the sheet's Cancel row, from the screen's own words.
export function Select<T extends string>({ label, value, options, onChange, disabled, cancel }: { label: string; value: T; options: SelectOption<T>[]; onChange: (value: T) => void; disabled?: boolean; cancel: string }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const pick = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };
  function press() {
    if (process.env.EXPO_OS !== "ios") return setOpen((was) => !was);
    // ponytail: the sheet marks no tick on the chosen one; a native context menu with ticks needs @expo/ui.
    ActionSheetIOS.showActionSheetWithOptions({ title: label, options: [...options.map((option) => option.label), cancel], cancelButtonIndex: options.length }, (index) => {
      if (index < options.length) pick(options[index].value);
    });
  }
  return (
    <>
      <Row title={label} value={chosen?.label} disabled={disabled} onPress={press} accessory={<Icon name={open ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />} />
      {open &&
        options.map((option) => (
          <Row
            key={option.value}
            title={option.label}
            onPress={() => pick(option.value)}
            accessory={option.value === value ? <Icon name="check" size="md" color="label" weight="semibold" /> : undefined}
          />
        ))}
    </>
  );
}
