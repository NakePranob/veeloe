import { useState } from "react";
import { View } from "react-native";
import { chosenLabel, SelectChip, type SelectProps } from "./select-chip";
import { radius, useColors } from "./theme";

// The web's Select (iOS and Android have their own files): an invisible
// <select> laid over our chip, so the browser opens its own list, and keyboards
// and screen readers get a real select.
export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  // The select is invisible, so the chip draws its keyboard focus ring.
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        borderRadius: radius.pill,
        outlineStyle: "solid",
        outlineWidth: focused ? 2 : 0,
        outlineOffset: 2,
        outlineColor: colors.label,
      }}
    >
      <SelectChip text={chosenLabel({ value, options })} pressed={hovered} />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocused(false)}
        // 16px keeps iOS Safari from zooming in when the select takes focus.
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 16 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </View>
  );
}
