import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { motion, space, type, useColors } from "./theme";

interface Props {
  value: string;
  // What a screen reader says for the words before they are tapped ("Task name: …, tap to rename").
  label: string;
  // Called with the trimmed words when the field is left; an empty or unchanged one is not.
  onSave: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

// A title that is words until tapped, then the same words as a field in place: Return or leaving it saves.
export function EditableTitle({ value, label, onSave, maxLength, disabled }: Props) {
  const colors = useColors();
  const [draft, setDraft] = useState<string | null>(null);
  const leave = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next !== "" && next !== value) onSave(next);
  };
  if (draft !== null)
    return (
      <TextInput
        autoFocus
        value={draft}
        onChangeText={(text) => setDraft(text.replace(/\n/g, " "))}
        onBlur={leave}
        onSubmitEditing={leave}
        returnKeyType="done"
        maxLength={maxLength}
        accessibilityLabel={label}
        selectionColor={colors.label}
        style={[type.headline, { alignSelf: "stretch", minHeight: 44, paddingHorizontal: space.sm, textAlign: "center", color: colors.label }]}
      />
    );
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => setDraft(value)}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: space.sm, justifyContent: "center", transform: [{ scale: pressed ? motion.press : 1 }] })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs }}>
        <Text variant="headline" style={{ textAlign: "center", flexShrink: 1 }}>
          {value}
        </Text>
        {!disabled && <Icon name="edit" size="sm" color="secondaryLabel" />}
      </View>
    </Pressable>
  );
}
