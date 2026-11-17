import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable } from "react-native";
import { Icon, type IconName } from "./icon";
import { useReduceMotion } from "./reduce-motion";
import { Text } from "./text";
import { motion, radius, space, useColors, useShadows } from "./theme";

interface Props {
  // The words on the pill, or what a screen reader says for an icon-only one.
  label: string;
  onPress: () => void;
  // primary: the ink pill, one per view, for the action the screen is for.
  // chip: a quiet grey pill for everything beside it.
  // ghost: no background at rest, for a header action that is only an icon.
  // destructive: a chip whose words are red, for an action that removes something.
  // floating: an ink circle with a shadow that drifts gently, beside what it acts on
  //   (shuffle beside the Character). Needs an icon.
  variant?: "primary" | "chip" | "ghost" | "destructive" | "floating";
  // With an icon the button is a circle showing only the icon, such as send.
  icon?: IconName;
  // Dimmed to a chip and inert, for an action not ready yet (send with nothing typed).
  disabled?: boolean;
}

// A pill, or a circle when it carries only an icon. It sinks a little while
// pressed, eased out, so a tap is felt before its result arrives.
export function Button({ label, onPress, variant = "chip", icon, disabled }: Props) {
  const colors = useColors();
  const shadows = useShadows();
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const native = process.env.EXPO_OS !== "web";
  const press = (to: number) => Animated.timing(scale, { toValue: to, duration: motion.duration.quick, easing: motion.easeOut, useNativeDriver: native }).start();
  const floating = variant === "floating" && !disabled;
  // A floating button drifts up and down, and stays still when the device asks for less motion.
  useEffect(() => {
    if (!floating || reduce) {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: -5, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(drift, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [floating, reduce, drift, native]);
  const inked = (variant === "primary" || variant === "floating") && !disabled;
  const ghost = variant === "ghost";
  const ink = inked ? "onAccent" : disabled ? "tertiaryLabel" : variant === "destructive" ? "redText" : ghost ? "accent" : "label";
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
      {({ pressed }) => {
        // A ghost button has nothing behind it until it is pressed.
        const background = inked ? colors.accent : pressed ? colors.chipPressed : ghost ? "transparent" : colors.chip;
        const size = floating ? 48 : 36;
        return (
          <Animated.View
            style={{
              transform: [{ scale }, { translateY: drift }],
              // 36 plus hit slop clears the 44pt target.
              minHeight: size,
              minWidth: size,
              paddingHorizontal: icon ? 0 : space.lg,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: background,
              boxShadow: floating ? shadows.floating : undefined,
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
        );
      }}
    </Pressable>
  );
}
