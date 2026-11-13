import { useState } from "react";
import { Row } from "./forms";
import { Icon } from "./icon";

/** One choice: the value the screen keeps, and the words it shows. */
export type SelectOption<T extends string> = { value: T; label: string };

/**
 * One row that says what is chosen and opens the other choices under it, ticked,
 * as controller-prototype's Select does without @expo/ui. The label names the
 * choice, so a screen reader reads "Agent, every Agent" rather than just a value.
 */
export function Select<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: SelectOption<T>[]; onChange: (value: T) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  return (
    <>
      <Row
        title={label}
        value={chosen?.label}
        onPress={disabled ? undefined : () => setOpen((was) => !was)}
        accessory={<Icon name={open ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />}
      />
      {open &&
        options.map((option) => (
          <Row
            key={option.value}
            title={option.label}
            onPress={() => {
              setOpen(false);
              if (option.value !== value) onChange(option.value);
            }}
            accessory={option.value === value ? <Icon name="check" size="md" color="label" weight="semibold" /> : undefined}
          />
        ))}
    </>
  );
}
