import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { useReduceMotion } from "./reduce-motion";
import { useOnCard } from "./surface";
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
  // surface: a white pill, for the second answer on a coloured card (deny on an Approval).
  variant?: "primary" | "chip" | "ghost" | "destructive" | "floating" | "surface";
  // With an icon the button is a circle showing only the icon, such as send.
  icon?: IconName;
  // Dimmed to a chip and inert, for an action not ready yet (send with nothing typed).
  disabled?: boolean;
  // large: the full-width 50pt pill a screen pins at its foot for its one action (the boards' footer button).
  // small: a 32pt circle or pill inside a row. On an icon-only circle, large is the 44pt composer button.
  size?: "small" | "regular" | "large";
  // An icon before the words, on a pill that keeps its label ("+ ผูก Machine").
  leading?: IconName;
  // One of several choices: true for the chosen one, so a screen reader says which (the Usage window).
  pressed?: boolean;
}

// A pill, or a circle when it carries only an icon. It sinks a little while
// pressed, eased out, so a tap is felt before its result arrives.
export function Button({ label, onPress, variant = "chip", icon, disabled, size = "regular", leading, pressed: chosen }: Props) {
  const onCard = useOnCard();
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
  // A disabled ink button stays ink, faded, as on the board.
  const inked = variant === "primary" || variant === "floating";
  const ghost = variant === "ghost";
  const ink = inked ? "onAccent" : disabled ? "tertiaryLabel" : variant === "destructive" ? "redText" : ghost ? "accent" : "label";
  return (
    <Pressable
      role="button"
      aria-label={icon ? label : undefined}
      aria-disabled={disabled}
      aria-pressed={chosen}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => press(motion.press)}
      onPressOut={() => press(1)}
      hitSlop={space.xs}
      style={size === "large" ? { alignSelf: "stretch" } : undefined}
    >
      {({ pressed }) => {
        // A ghost button has nothing behind it until it is pressed.
        const background = inked ? colors.accent : pressed ? colors.chipPressed : ghost ? "transparent" : (variant === "surface" || variant === "destructive" || onCard) && !disabled ? colors.surface : colors.chip;
        const large = size === "large";
        const side = floating ? 48 : size === "small" ? 32 : large ? (icon ? 44 : 50) : 44;
        return (
          <Animated.View
            style={{
              transform: [{ scale }, { translateY: drift }],
              opacity: disabled && inked ? 0.3 : 1,
              minHeight: side,
              minWidth: side,
              paddingHorizontal: icon ? 0 : size === "small" ? 14 : 18,
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {leading && <Icon name={leading} size="sm" color={ink} weight="semibold" />}
                <Text variant={large ? "body" : "subheadline"} strong style={[{ color: colors[ink] }, !large && { fontSize: size === "small" ? 13 : 14 }]}>
                  {label}
                </Text>
              </View>
            )}
          </Animated.View>
        );
      }}
    </Pressable>
  );
}
