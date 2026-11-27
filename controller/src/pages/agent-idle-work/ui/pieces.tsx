import type { ListedTrigger } from "@veeloe/protocol-ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";
import { useT } from "../../../shared/i18n";
import { Card, Dot, Grip, motion, Row, Section, space } from "../../../shared/ui";
import { dropIndex, progressOf } from "../model/idle";
import { STATUS } from "./sign";

type Drag = { from: number; to: number };

/**
 * The pieces of a list as rows, each dragged by its handle to a new place, as Reminders reorders a list. A row
 * opens its sheet; a drop calls `move` with the piece and where it goes. The order is shown as dropped until
 * the Machine answers with the list signed again.
 */
export function Pieces({
  list,
  language,
  open,
  move,
  locked,
  onDragging,
}: {
  list: ListedTrigger;
  language: string;
  open: (piece: string) => void;
  move: (piece: string, to: number) => Promise<boolean>;
  locked: boolean;
  onDragging: (dragging: boolean) => void;
}) {
  const t = useT("agent-idle-work");
  const shown = progressOf(list);
  const [order, setOrder] = useState<string[] | null>(null);
  // A new list from the Machine is the order now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `list` is the trigger, which changes only when the Machine sends the list again
  useEffect(() => setOrder(null), [list]);
  const pieces = order ? order.flatMap((id) => shown.filter((piece) => piece.id === id)) : shown;
  const heights = useRef<number[]>([]);
  // The dragged row follows the finger on `dy`; every other row slides on its own value.
  const dy = useRef(new Animated.Value(0)).current;
  const shifts = useRef(new Map<string, Animated.Value>()).current;
  const shiftOf = (id: string) => {
    const held = shifts.get(id);
    if (held) return held;
    const value = new Animated.Value(0);
    shifts.set(id, value);
    return value;
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const slide = (value: Animated.Value, toValue: number) => Animated.timing(value, { toValue, duration: motion.duration.fast, easing: motion.easeOut, useNativeDriver: true });

  // While dragging, the rows between where the row was and where it would land step aside by its height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the drag's two ends; the rows and heights are read as they stand
  useEffect(() => {
    if (!drag) return;
    const height = heights.current[drag.from] ?? 0;
    pieces.forEach((piece, index) => {
      if (index === drag.from) return;
      const target = index > drag.from && index <= drag.to ? -height : index < drag.from && index >= drag.to ? height : 0;
      slide(shiftOf(piece.id), target).start();
    });
  }, [drag?.from, drag?.to]);

  // Once the rows are drawn in their new order, every offset goes back to nothing in the same frame, so nothing jumps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order drawn changes
  useLayoutEffect(() => {
    dy.setValue(0);
    for (const value of shifts.values()) value.setValue(0);
  }, [order]);

  function release(from: number, to: number) {
    onDragging(false);
    // The row slides the rest of the way to its new place, then the order changes under it.
    const crossed = heights.current.slice(Math.min(from, to) + (to > from ? 1 : 0), Math.max(from, to) + (to > from ? 1 : 0)).reduce((sum, height) => sum + height, 0);
    slide(dy, to > from ? crossed : -crossed).start(() => {
      setDrag(null);
      if (to === from) return;
      const ids = pieces.map((piece) => piece.id);
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id);
      setOrder(ids);
      void move(id, to).then((sent) => !sent && setOrder(null));
    });
  }

  function step(from: number, to: number) {
    if (to < 0 || to >= pieces.length) return;
    const ids = pieces.map((piece) => piece.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    setOrder(ids);
    void move(id, to).then((sent) => !sent && setOrder(null));
  }

  const when = (at: number) => new Date(at).toLocaleString(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Section title={t("pieces.heading")} footer={list.idle?.order === "oldest-first" ? t("pieces.oldestFirst") : t("pieces.ordered")}>
      {pieces.length === 0 && <Row title={t("pieces.allDone")} />}
      {pieces.map((piece, index) => {
        const lifted = drag?.from === index;
        return (
          <Animated.View
            key={piece.id}
            onLayout={(event) => {
              heights.current[index] = event.nativeEvent.layout.height;
            }}
            style={{ zIndex: lifted ? 1 : 0, transform: [{ translateY: lifted ? dy : shiftOf(piece.id) }] }}
          >
            {/* A lifted row floats over the others, raised like anything that floats over content. */}
            <Card raised={lifted} style={{ padding: 0, gap: 0 }}>
              <Row
                leading={<Dot color={STATUS[piece.status].dot} />}
                title={piece.text}
                detail={[t(STATUS[piece.status].words), piece.lastRunAt ? when(piece.lastRunAt) : null, piece.repeat ? t("pieces.repeat") : null].filter(Boolean).join(" · ")}
                onPress={() => open(piece.id)}
                accessory={
                  pieces.length > 1 && !locked ? (
                    <Handle
                      label={t("pieces.drag", { text: piece.text })}
                      onStart={() => {
                        onDragging(true);
                        dy.setValue(0);
                        setDrag({ from: index, to: index });
                      }}
                      onMove={(moved) => {
                        dy.setValue(moved);
                        const to = dropIndex(heights.current, index, moved);
                        if (dragRef.current && dragRef.current.to !== to) setDrag({ from: index, to });
                      }}
                      onEnd={() => release(index, dragRef.current?.to ?? index)}
                      onStep={(by) => step(index, index + by)}
                    />
                  ) : undefined
                }
              />
            </Card>
          </Animated.View>
        );
      })}
    </Section>
  );
}

/** The grip on the right of a row: dragged, it moves the row; VoiceOver moves it one place with swipe up or down. */
function Handle({ label, onStart, onMove, onEnd, onStep }: { label: string; onStart: () => void; onMove: (dy: number) => void; onEnd: () => void; onStep: (step: 1 | -1) => void }) {
  const latest = useRef({ onStart, onMove, onEnd });
  latest.current = { onStart, onMove, onEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Once a drag has the finger, the list does not scroll it away.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => latest.current.onStart(),
        onPanResponderMove: (_, gesture) => latest.current.onMove(gesture.dy),
        onPanResponderRelease: () => latest.current.onEnd(),
        onPanResponderTerminate: () => latest.current.onEnd(),
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      aria-label={label}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => onStep(event.nativeEvent.actionName === "increment" ? -1 : 1)}
      hitSlop={space.sm}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Grip />
    </View>
  );
}
