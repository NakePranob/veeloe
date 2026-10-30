import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { motion, useColors, type Colors } from "../../../shared/ui";
import { lookOf, type Decal, type Look, type Shell, type Sides, type Top } from "../model/look";

// What the Agent is doing, as the Task entity works it out (moodOf). It moves the head, never the look.
type Mood = "idle" | "thinking" | "working" | "waiting" | "done" | "offline";

interface Props {
  look: Look;
  mood: Mood;
  size?: number;
  // What it floats over, so the ring around the raised hand reads as a cut-out, not an outline.
  backdrop?: keyof Colors;
  // Holds the pose without moving, as when motion is reduced: for a grid of options.
  still?: boolean;
}

// A screen and its LEDs look the same in light and dark, like the hardware they draw.
const SCREEN = "#151b25";
const SCREEN_TOP = "#070a10";
const SCREEN_BOTTOM = "#1f2836";
const LED = "#eef6ff";

// Each shell on a 100 × 100 grid, its bottom on y 84. visor: x, y, width, height, radius; top: the top
// socket's y; side: the side sockets' x; hand: where the raised hand floats.
const SHELLS: Record<Shell, { d: string; round?: number; visor: number[]; top: number; side: [number, number]; hand: [number, number] }> = {
  box: { d: "M30 26H70A16 16 0 0 1 86 42V68A16 16 0 0 1 70 84H30A16 16 0 0 1 14 68V42A16 16 0 0 1 30 26Z", visor: [22, 37, 56, 34, 11], top: 26, side: [14, 86], hand: [86, 27] },
  capsule: { d: "M37 30H63A27 27 0 0 1 63 84H37A27 27 0 0 1 37 30Z", visor: [20, 41, 60, 30, 15], top: 30, side: [10, 90], hand: [88, 33] },
  dome: { d: "M14 76V58a36 36 0 0 1 72 0v18q0 8-8 8H22q-8 0-8-8Z", visor: [22, 44, 56, 28, 12], top: 22, side: [14, 86], hand: [81, 27] },
  chamfer: { d: "M30 24H70L86 40V68L70 84H30L14 68V40Z", round: 6, visor: [22, 38, 56, 34, 10], top: 21, side: [12, 88], hand: [84, 27] },
};

// How each Mood holds the head: tilt in degrees, turn from −1 (its left) to 1, how far it sinks and
// where the eyes look in grid units, and how open the eyes are.
const POSE: Record<Mood, { tilt: number; turn: number; lift: number; look: [number, number]; open: number }> = {
  idle: { tilt: 0, turn: 0, lift: 0, look: [0, 0], open: 1 },
  thinking: { tilt: -8, turn: 0.4, lift: 0, look: [3, -4], open: 1 },
  working: { tilt: 2, turn: 0, lift: 1, look: [0, 1], open: 0.4 },
  waiting: { tilt: -6, turn: 0, lift: -1, look: [0, 0], open: 1.08 },
  done: { tilt: -4, turn: 0, lift: 0, look: [0, 0], open: 1 },
  offline: { tilt: 12, turn: 0, lift: 8, look: [0, 0], open: 1 },
};

// How long one float up (or down) takes; working nods instead, offline rests on the ground.
const FLOAT: Partial<Record<Mood, number>> = { idle: 1800, thinking: 2500, waiting: 1200, done: 1800 };

const AT_REST: Mood[] = ["idle", "done", "offline"];
const native = process.env.EXPO_OS !== "web";

// The parts are the shell's colour, darker; white mixes in the lit side.
function mix(hex: string, k: number, to = [26, 32, 48]) {
  const n = parseInt(hex.slice(1), 16);
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (to[i] - v) * k).toString(16).padStart(2, "0")).join("");
}

function grey(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = Math.round(0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255));
  return "#" + l.toString(16).padStart(2, "0").repeat(3);
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

// One slice of the head: an SVG on the shared grid, inside a view that moves on its own.
function Layer({ style, children }: { style?: object; children: ReactNode }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        {children}
      </Svg>
    </Animated.View>
  );
}

function TopPart({ top, y, c }: { top: Top; y: number; c: string }) {
  if (top === "antenna")
    return (
      <>
        <Path d={`M50 ${y + 3}V${y - 10}`} stroke={c} strokeWidth={3.2} strokeLinecap="round" />
        <Circle cx={50} cy={y - 14} r={4.6} fill={c} />
      </>
    );
  if (top === "twin")
    return (
      <>
        <Path d={`M41 ${y + 4}L35 ${y - 8}M59 ${y + 4}L65 ${y - 8}`} stroke={c} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={34} cy={y - 11} r={3.6} fill={c} />
        <Circle cx={66} cy={y - 11} r={3.6} fill={c} />
      </>
    );
  if (top === "fin") return <Rect x={45.5} y={y - 11} width={9} height={16} rx={4.5} fill={c} />;
  if (top === "beacon")
    return (
      <>
        <Path d={`M43.5 ${y - 3}a6.5 6.5 0 0 1 13 0Z`} fill={LED} />
        <Rect x={40} y={y - 4} width={20} height={7} rx={3.5} fill={c} />
      </>
    );
  return null;
}

function SidePart({ sides, x: [l, r], y, c }: { sides: Sides; x: [number, number]; y: number; c: string }) {
  if (sides === "ears") return [l, r].map((x) => <Circle key={x} cx={x} cy={y} r={7.5} fill={c} />);
  if (sides === "pods") return [l, r].map((x) => <Rect key={x} x={x - 5} y={y - 11} width={10} height={22} rx={5} fill={c} />);
  if (sides === "fins")
    return (
      <Path
        d={`M${l + 3} ${y + 4}L${l - 8} ${y - 12}L${l + 3} ${y - 6}ZM${r - 3} ${y + 4}L${r + 8} ${y - 12}L${r - 3} ${y - 6}Z`}
        fill={c}
        stroke={c}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    );
  return null;
}

function DecalPart({ decal, visor: [vx, vy, vw, vh], c }: { decal: Decal; visor: number[]; c: string }) {
  const fx = vx + vw / 2;
  if (decal === "brow") return <Rect x={fx - 14} y={vy - 8} width={28} height={4} rx={2} fill={c} />;
  if (decal === "lights") return [-6, 0, 6].map((d) => <Circle key={d} cx={fx + d} cy={vy - 6} r={2.1} fill={c} />);
  const gy = vy + vh + 4;
  if (decal === "grille")
    return [-6, 0, 6].map((d) => <Rect key={d} x={fx + d - 1.4} y={gy} width={2.8} height={Math.min(7, 81 - gy)} rx={1.4} fill={c} />);
  return null;
}

// A floating robot head drawn 2.5D: a lit front over a darker wall, a screen set into it. Turning slides
// the screen toward the turn and the wall and side parts against it. Who it is never changes with the
// Mood; offline is the one exception, greyed out because the Agent can't be reached.
export function Character({ look: given, mood, size = 44, backdrop = "background", still }: Props) {
  const colors = useColors();
  const reduce = useReduceMotion() || !!still;
  const id = useId().replace(/[^\w-]/g, "");
  const look = lookOf(given);
  const s = SHELLS[look.shell];
  const [vx, vy, vw, vh, vr] = s.visor;
  const fy = vy + vh / 2;
  const u = size / 100;

  const base = mood === "offline" ? grey(look.color) : look.color;
  const part = mix(base, 0.42);
  const wall = mix(base, 0.28);
  const low = mix(base, 0.1);
  const lit = mix(base, 0.4, [255, 255, 255]);

  const pose = POSE[mood];
  const v = useRef({
    tilt: new Animated.Value(pose.tilt),
    turn: new Animated.Value(pose.turn),
    lift: new Animated.Value(pose.lift),
    lookX: new Animated.Value(pose.look[0]),
    lookY: new Animated.Value(pose.look[1]),
    open: new Animated.Value(pose.open),
    blink: new Animated.Value(1),
    float: new Animated.Value(0),
    nod: new Animated.Value(0),
    wave: new Animated.Value(0),
    pulse: new Animated.Value(1),
    scan: new Animated.Value(0),
    hop: new Animated.Value(1),
  }).current;
  const last = useRef(mood);

  // A new pose springs in with a little overshoot. A Turn starting hops; finishing hops and spins once.
  useEffect(() => {
    const was = last.current;
    last.current = mood;
    if (was === mood) return;
    const to = POSE[mood];
    const targets: [Animated.Value, number][] = [
      [v.tilt, to.tilt],
      [v.lift, to.lift],
      [v.lookX, to.look[0]],
      [v.lookY, to.look[1]],
      [v.open, to.open],
    ];
    if (mood !== "done") targets.push([v.turn, to.turn]);
    if (reduce) {
      targets.forEach(([value, target]) => value.setValue(target));
      v.turn.setValue(to.turn);
      return;
    }
    const moves = targets.map(([value, toValue]) => Animated.spring(value, { toValue, speed: 14, bounciness: 8, useNativeDriver: native }));
    const hops = mood === "done" || (AT_REST.includes(was) && !AT_REST.includes(mood));
    if (hops) {
      v.hop.setValue(0);
      moves.push(Animated.timing(v.hop, { toValue: 1, duration: 700, easing: motion.easeOut, useNativeDriver: native }));
    }
    if (mood === "done")
      moves.push(
        Animated.sequence([
          Animated.timing(v.turn, { toValue: -1, duration: 250, easing: motion.easeOut, useNativeDriver: native }),
          Animated.timing(v.turn, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
          Animated.spring(v.turn, { toValue: 0, speed: 14, bounciness: 8, useNativeDriver: native }),
        ]),
      );
    const all = Animated.parallel(moves);
    all.start();
    return () => all.stop();
  }, [mood, reduce, v]);

  // What keeps going while the Mood lasts. Slow sine waves read as breathing, not as routine UI motion.
  useEffect(() => {
    if (reduce) return;
    const swing = (value: Animated.Value, from: number, to: number, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: to, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
          Animated.timing(value, { toValue: from, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        ]),
      );
    const loops: Animated.CompositeAnimation[] = [];
    if (FLOAT[mood]) loops.push(swing(v.float, 0, 1, FLOAT[mood]));
    if (mood === "working") loops.push(swing(v.nod, 0, 1, 250), swing(v.scan, 0, 1, 900));
    if (mood === "waiting") loops.push(swing(v.wave, 0, 1, 800));
    if (mood === "thinking") loops.push(swing(v.pulse, 1, 0.25, 600));
    if (mood !== "done" && mood !== "offline")
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.delay(3800),
            Animated.timing(v.blink, { toValue: 0.1, duration: 70, useNativeDriver: native }),
            Animated.timing(v.blink, { toValue: 1, duration: 110, useNativeDriver: native }),
          ]),
        ),
      );
    loops.forEach((loop) => loop.start());
    return () => {
      loops.forEach((loop) => loop.stop());
      for (const value of [v.float, v.nod, v.wave])
        Animated.timing(value, { toValue: 0, duration: motion.duration.fast, easing: motion.easeOut, useNativeDriver: native }).start();
      v.blink.setValue(1);
      v.pulse.setValue(1);
    };
  }, [mood, reduce, v]);

  const deg = (value: Animated.Value, range: number[], out: number[]) =>
    value.interpolate({ inputRange: range, outputRange: out.map((n) => `${n}deg`) });
  const slide = (k: number) => ({ translateX: v.turn.interpolate({ inputRange: [-1, 1], outputRange: [-k * u, k * u] }) });

  return (
    <View aria-hidden style={{ width: size, height: size, opacity: mood === "offline" ? 0.5 : 1 }}>
      {/* The shadow on the ground shrinks as the head floats up. */}
      <Layer style={{ transformOrigin: "50% 95%", transform: [{ scale: v.float.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) }] }}>
        <Defs>
          <RadialGradient id={`${id}g`}>
            <Stop offset={0} stopColor={colors.ground} />
            <Stop offset={1} stopColor={colors.ground} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={50} cy={95} rx={27} ry={4.4} fill={`url(#${id}g)`} />
      </Layer>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: Animated.multiply(v.lift, u) }] }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: v.float.interpolate({ inputRange: [0, 1], outputRange: [0, -4 * u] }) }] }]}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                transformOrigin: "50% 84%",
                transform: [
                  { translateY: v.hop.interpolate({ inputRange: [0, 0.25, 0.55, 0.8, 1], outputRange: [0, 2 * u, -12 * u, u, 0] }) },
                  { scaleX: v.hop.interpolate({ inputRange: [0, 0.25, 0.55, 0.8, 1], outputRange: [1, 1.06, 0.96, 1.02, 1] }) },
                  { scaleY: v.hop.interpolate({ inputRange: [0, 0.25, 0.55, 0.8, 1], outputRange: [1, 0.9, 1.05, 0.98, 1] }) },
                ],
              },
            ]}
          >
            <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: "50% 55%", transform: [{ rotate: deg(v.tilt, [-180, 180], [-180, 180]) }] }]}>
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    transformOrigin: "50% 55%",
                    transform: [{ translateY: v.nod.interpolate({ inputRange: [0, 1], outputRange: [0, 2 * u] }) }, { rotate: deg(v.nod, [0, 1], [0, 2]) }],
                  },
                ]}
              >
                <Layer style={{ transform: [slide(-4)] }}>
                  <SidePart sides={look.sides} x={s.side} y={fy} c={part} />
                </Layer>
                {/* The top part sways with the float and boings after a hop, a beat behind the head. */}
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    { transformOrigin: `50% ${s.top}%`, transform: [{ rotate: deg(v.hop, [0, 0.3, 0.5, 0.7, 0.85, 1], [0, 14, -10, 6, -3, 0]) }] },
                  ]}
                >
                  <Layer style={{ transformOrigin: `50% ${s.top}%`, transform: [slide(2.5), { rotate: deg(v.float, [0, 1], [-3, 3]) }] }}>
                    <TopPart top={look.top} y={s.top} c={part} />
                  </Layer>
                </Animated.View>
                <Layer style={{ transform: [slide(-4.5), { translateY: 5 * u }] }}>
                  <Path d={s.d} fill={wall} stroke={wall} strokeWidth={s.round ?? 0} strokeLinejoin="round" />
                </Layer>
                <Layer style={{ transform: [slide(1.5)] }}>
                  <Defs>
                    <LinearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset={0} stopColor={lit} />
                      <Stop offset={0.5} stopColor={base} />
                      <Stop offset={1} stopColor={low} />
                    </LinearGradient>
                  </Defs>
                  <Path d={s.d} fill={`url(#${id}s)`} stroke={`url(#${id}s)`} strokeWidth={s.round ?? 0} strokeLinejoin="round" />
                </Layer>
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      transformOrigin: `50% ${fy}%`,
                      transform: [slide(5.5), { scaleX: v.turn.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.9, 1, 0.9] }) }],
                    },
                  ]}
                >
                  <Layer>
                    <Defs>
                      <LinearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
                        <Stop offset={0} stopColor={SCREEN_TOP} />
                        <Stop offset={1} stopColor={SCREEN_BOTTOM} />
                      </LinearGradient>
                    </Defs>
                    <DecalPart decal={look.decal} visor={s.visor} c={part} />
                    <Rect x={vx} y={vy} width={vw} height={vh} rx={vr} fill={mood === "offline" ? SCREEN : `url(#${id}v)`} />
                    <Path d={`M${vx + 4} ${vy + vh - 4}L${vx + 10} ${vy + 4}h4L${vx + 8} ${vy + vh - 4}Z`} fill="#ffffff" opacity={0.1} />
                  </Layer>
                  {mood !== "offline" && (
                    <Layer
                      style={{
                        transformOrigin: `50% ${fy}%`,
                        transform: [
                          { translateX: Animated.multiply(v.lookX, u) },
                          { translateY: Animated.multiply(v.lookY, u) },
                          { scaleY: Animated.multiply(v.open, v.blink) },
                        ],
                      }}
                    >
                      {[-12, 12].map((dx) =>
                        mood === "done" ? (
                          <Path key={dx} d={`M${50 + dx - 5} ${fy + 2.5}Q${50 + dx} ${fy - 5} ${50 + dx + 5} ${fy + 2.5}`} stroke={LED} strokeWidth={3} strokeLinecap="round" fill="none" />
                        ) : (
                          <Rect key={dx} x={50 + dx - 4} y={fy - 6} width={8} height={12} rx={4} fill={LED} />
                        ),
                      )}
                    </Layer>
                  )}
                  {mood === "thinking" && (
                    <Layer style={{ opacity: v.pulse }}>
                      {[-5, 0, 5].map((dx) => (
                        <Circle key={dx} cx={50 + dx} cy={vy + vh - 5.5} r={1.6} fill={LED} />
                      ))}
                    </Layer>
                  )}
                  {mood === "working" && (
                    <Layer style={{ transform: [{ translateX: v.scan.interpolate({ inputRange: [0, 1], outputRange: [0, (vw - 22) * u] }) }] }}>
                      <Rect x={vx + 6} y={vy + vh - 6} width={10} height={2.2} rx={1.1} fill={LED} />
                    </Layer>
                  )}
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </Animated.View>
          {/* Waiting on a person: the one orange in the app floats up beside the head and waves. */}
          {mood === "waiting" && (
            <Layer style={{ transformOrigin: `${s.hand[0]}% ${s.hand[1] + 18}%`, transform: [{ rotate: deg(v.wave, [0, 1], [-10, 14]) }] }}>
              <Rect x={s.hand[0] - 7.5} y={s.hand[1] - 8.5} width={15} height={17} rx={5.5} fill={colors.orange} stroke={colors[backdrop]} strokeWidth={3} />
            </Layer>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
