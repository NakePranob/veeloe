import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from "react-native";
import { Icon, type IconName } from "./icon";
import { useReduceMotion } from "./reduce-motion";
import { Text } from "./text";
import { motion, radius, space, useColors } from "./theme";

/** One button a swipe uncovers. The first one is also what a long swipe does. */
export type SwipeAction = { icon: IconName; label: string; onPress: () => void };

/** What a Swipe gives its row, so VoiceOver can reach the actions the gesture hides. */
export type SwipeAccess = { accessibilityActions: AccessibilityActionInfo[]; onAccessibilityAction: (event: AccessibilityActionEvent) => void };

// One button's width; the buttons sit apart and off the row's edge by space.sm.
const ACTION = 72;
// A drag becomes a swipe once it has gone this far sideways, and stays the list's scroll if it moves this far up or down first.
const ACTIVATE = 10;
// Dragging the side with no buttons pulls the row this many times slower, then it springs back.
const FRICTION = 8;
// Released past this share of its buttons the row stays open; past this share of the row a long swipe runs the first action.
const OPEN_AT = 0.5;
const LONG_AT = 0.5;

// One row is open at a time: opening another, or scrolling the list, closes it (closeSwipes).
let closeOpen: (() => void) | null = null;

/** Closes whichever row is open, for a list to call when it starts to scroll. */
export function closeSwipes() {
  closeOpen?.();
}

/**
 * A row that slides left to uncover buttons on its right, as Mail's rows do. A short swipe springs back,
 * one past half the buttons leaves them open, and one past half the row runs the first action at once.
 * Tapping the row while open closes it. Built on PanResponder and Animated, with no gesture library:
 * HeroUI Pro's SwipeableRow is the model for its thresholds and the buttons' entrance.
 * ponytail: no haptic on a long swipe; add it with expo-haptics if the swipe needs to be felt.
 */
export function Swipe({ actions, children }: { actions: readonly SwipeAction[]; children: ReactNode | ((access: SwipeAccess) => ReactNode) }) {
  const colors = useColors();
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  const width = useRef(0);
  const [open, setOpen] = useState(false);
  // In state as well, so the long swipe's stretch is drawn for the row's real width.
  const [rowWidth, setRowWidth] = useState(0);
  const rail = actions.length * (ACTION + space.sm);
  const latest = useRef({ actions, rail, reduce });
  latest.current = { actions, rail, reduce };

  const responder = useMemo(() => {
    const settle = (to: number, then?: () => void) => {
      at.current = to;
      setOpen(to !== 0);
      if (to !== 0) {
        if (closeOpen && closeOpen !== close) closeOpen();
        closeOpen = close;
      } else if (closeOpen === close) closeOpen = null;
      Animated.timing(x, { toValue: to, duration: latest.current.reduce ? 0 : motion.duration.fast, easing: motion.easeOut, useNativeDriver: false }).start(() => then?.());
    };
    const close = () => settle(0);
    const offset = (dx: number) => {
      const to = at.current + dx;
      return to > 0 ? to / FRICTION : Math.max(to, -width.current);
    };
    return {
      settle,
      close,
      handlers: PanResponder.create({
        // In the capture phase, so a pressable inside the row (the row itself, a button on it) cannot keep a sideways drag.
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > ACTIVATE && Math.abs(g.dy) < ACTIVATE,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => x.setValue(offset(g.dx)),
        onPanResponderRelease: (_, g) => {
          const to = offset(g.dx);
          const { actions, rail } = latest.current;
          if (actions[0] && -to > width.current * LONG_AT)
            settle(-width.current, () => {
              actions[0]?.onPress();
              settle(0);
            });
          else settle(-to > rail * OPEN_AT ? -rail : 0);
        },
        onPanResponderTerminate: () => settle(at.current),
      }).panHandlers,
    };
  }, [x]);

  const run = (action: SwipeAction) => {
    responder.close();
    action.onPress();
  };
  const access: SwipeAccess = {
    accessibilityActions: actions.map((action, index) => ({ name: `swipe-${index}`, label: action.label })),
    onAccessibilityAction: (event) => {
      const action = actions[Number(event.nativeEvent.actionName.replace("swipe-", ""))];
      if (action) action.onPress();
    },
  };
  // The buttons grow in from half size as the row uncovers them, the outermost first.
  const shown = x.interpolate({ inputRange: [-rail, 0], outputRange: [1, 0], extrapolate: "clamp" });
  // A long swipe stretches the first, outermost button over the space the row leaves.
  const far = Math.max(rowWidth, rail + 1);
  const stretch = x.interpolate({ inputRange: [-far, -rail, 0], outputRange: [far - (rail - ACTION), ACTION, ACTION], extrapolate: "clamp" });

  return (
    <View
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width;
        setRowWidth(event.nativeEvent.layout.width);
      }}
    >
      {/* rail counts one space.sm per button: the gaps between them, and this inset off the screen's edge. */}
      <View aria-hidden={!open} style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row-reverse", alignItems: "stretch", gap: space.sm, paddingVertical: space.xs, paddingRight: space.sm }}>
        {actions.map((action, index) => (
          <Animated.View key={action.label} style={{ width: index === 0 ? stretch : ACTION }}>
            <Pressable role="button" aria-label={action.label} onPress={() => run(action)} style={{ flex: 1 }}>
              {({ pressed }) => (
                <Animated.View
                  style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: space.xs,
                    borderRadius: radius.md,
                    borderCurve: "continuous",
                    backgroundColor: pressed ? colors.chipPressed : colors.card,
                    opacity: shown,
                    transform: [{ scale: x.interpolate({ inputRange: [-rail + index * (ACTION + space.sm), 0], outputRange: [1, 0.5], extrapolate: "clamp" }) }],
                  }}
                >
                  <Icon name={action.icon} size="md" />
                  <Text variant="caption2" numberOfLines={1}>
                    {action.label}
                  </Text>
                </Animated.View>
              )}
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <Animated.View {...responder.handlers} style={{ transform: [{ translateX: x }], backgroundColor: colors.background }}>
        {typeof children === "function" ? children(access) : children}
        {/* While open, a tap on the row closes it instead of opening what the row opens. */}
        {open && <Pressable aria-hidden onPress={responder.close} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />}
      </Animated.View>
    </View>
  );
}
