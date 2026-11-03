import { useRef } from "react";
import { Animated, Pressable } from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { motion, radius, space, useColors } from "./theme";

interface Props {
  // The words on the pill, or what a screen reader says for an icon-only one.
  label: string;
  onPress: () => void;
  // primary: the ink pill, one per view, for the action the screen is for.
  // chip: a quiet grey pill for everything beside it.
  variant?: "primary" | "chip";
  // With an icon the button is a circle showing only the icon, such as send.
  icon?: IconName;
  // Dimmed to a chip and inert, for an action not ready yet (send with nothing typed).
  disabled?: boolean;
}

// A pill, or a circle when it carries only an icon. It sinks a little while
// pressed, eased out, so a tap is felt before its result arrives.
export function Button({ label, onPress, variant = "chip", icon, disabled }: Props) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.timing(scale, { toValue: to, duration: motion.duration.quick, easing: motion.easeOut, useNativeDriver: process.env.EXPO_OS !== "web" }).start();
  const primary = variant === "primary" && !disabled;
  const ink = primary ? "onAccent" : disabled ? "tertiaryLabel" : "label";
  return (
    <Pressable
      role="button"
      aria-label={icon ? label : undefined}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => press(motion.press)}
      onPressOut={() => press(1)}
      hitSlop={space.xs}
    >
      {({ pressed }) => (
        <Animated.View
          style={{
            transform: [{ scale }],
            // 36 plus hit slop clears the 44pt target.
            minHeight: 36,
            minWidth: 36,
            paddingHorizontal: icon ? 0 : space.lg,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: primary ? colors.accent : pressed ? colors.chipPressed : colors.chip,
          }}
        >
          {icon ? (
            <Icon name={icon} size="md" color={ink} weight="semibold" />
          ) : (
            <Text variant="subheadline" strong style={{ color: colors[ink] }}>
              {label}
            </Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}
