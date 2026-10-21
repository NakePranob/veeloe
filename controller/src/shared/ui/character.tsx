import { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from "react-native-svg";

// ponytail: a still SVG stand-in until the Character is designed in Rive (#23).

export type CharacterKey = "egg" | "sprout" | "bear" | "pebble" | "bean" | "ghost" | "flower" | "gumdrop";
export type Mood = "idle" | "waiting" | "working" | "happy" | "off";

// Each Character is its own shape and colour. The colours are the same in both themes
// and hold at least 3.4:1 on white and on #0A0A0A.
const COLOR: Record<CharacterKey, string> = {
  egg: "#7B5CF0",
  sprout: "#0E9C8E",
  bear: "#1E8BDA",
  pebble: "#B07F3A",
  bean: "#4F63E8",
  ghost: "#A94CC4",
  flower: "#E0508E",
  gumdrop: "#5F7E9C",
};

function flowerPath() {
  let d = "";
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r = 48 + 7 * Math.cos(6 * a);
    d += `${i ? "L" : "M"}${(80 + r * Math.sin(a)).toFixed(1)} ${(94 - r * Math.cos(a)).toFixed(1)} `;
  }
  return d + "Z";
}

const SHAPE: Record<CharacterKey, { d: string; top: number; dy?: number; ears?: boolean; leaf?: boolean }> = {
  egg: { top: 30, d: "M80 30 C116 30 136 56 136 92 C136 126 112 142 80 142 C48 142 24 126 24 92 C24 56 44 30 80 30 Z" },
  sprout: { top: 36, leaf: true, d: "M80 36 C114 36 134 60 134 94 C134 126 110 142 80 142 C50 142 26 126 26 94 C26 60 46 36 80 36 Z" },
  bear: { top: 38, ears: true, d: "M80 38 C116 38 136 62 136 96 C136 128 112 142 80 142 C48 142 24 128 24 96 C24 62 44 38 80 38 Z" },
  pebble: { top: 54, dy: 12, d: "M80 54 C124 54 148 78 148 104 C148 130 120 142 80 142 C40 142 12 130 12 104 C12 78 36 54 80 54 Z" },
  bean: { top: 20, d: "M80 20 C106 20 120 38 120 64 L120 110 C120 132 104 142 80 142 C56 142 40 132 40 110 L40 64 C40 38 54 20 80 20 Z" },
  ghost: {
    top: 32,
    d: "M26 92 C26 56 50 32 80 32 C110 32 134 56 134 92 L134 128 C134 140 124 144 116 136 C110 130 104 130 98 137 C91 144 84 144 80 139 C76 144 69 144 62 137 C56 130 50 130 44 136 C36 144 26 140 26 128 Z",
  },
  flower: { top: 40, d: flowerPath() },
  gumdrop: { top: 30, d: "M80 30 C110 30 126 58 130 92 L134 126 C135 136 128 142 118 142 L42 142 C32 142 25 136 26 126 L30 92 C34 58 50 30 80 30 Z" },
};

function mix(hex: string, to: string, k: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(to.slice(i, i + 2), 16));
  return "#" + a.map((x, i) => Math.round(x + (b[i] - x) * k).toString(16).padStart(2, "0")).join("");
}

type Props = { character: CharacterKey; mood?: Mood; size?: number; label?: string };

export function Character({ character, mood = "idle", size = 44, label }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shape = SHAPE[character];
  const base = COLOR[character];
  const ink = mix(base, "#000000", 0.8);
  const deep = mix(base, "#000000", 0.25);
  // Under 56px the Character is flat with eyes only, so it reads at list size.
  const detail = size >= 56;
  const fill = detail ? `url(#${id}b)` : base;
  const dy = shape.dy ?? 0;
  const line = (d: string) => <Path d={d} fill="none" stroke={ink} strokeWidth={detail ? 4 : 8} strokeLinecap="round" />;

  let face;
  if (mood === "working") face = line("M55 86 Q63 80 71 86 M89 86 Q97 80 105 86");
  else if (mood === "happy") face = line("M55 87 Q63 76 71 87 M89 87 Q97 76 105 87");
  else if (mood === "off") face = line("M55 86 h16 M89 86 h16");
  else
    face = detail ? (
      <>
        <Ellipse cx={64} cy={82} rx={6.5} ry={9} fill={ink} />
        <Ellipse cx={96} cy={82} rx={6.5} ry={9} fill={ink} />
        <Circle cx={66.5} cy={78.5} r={2.3} fill="#FFFFFF" />
        <Circle cx={98.5} cy={78.5} r={2.3} fill="#FFFFFF" />
      </>
    ) : (
      <>
        <Ellipse cx={63} cy={84} rx={9} ry={12} fill={ink} />
        <Ellipse cx={97} cy={84} rx={9} ry={12} fill={ink} />
      </>
    );

  return (
    <View accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label} style={{ width: size, height: size, opacity: mood === "off" ? 0.7 : 1 }}>
      <Svg width={size} height={size} viewBox="0 0 160 160">
        {detail && (
          <Defs>
            <RadialGradient id={`${id}b`} cx="0.36" cy="0.28" r="0.9">
              <Stop offset="0" stopColor={mix(base, "#FFFFFF", 0.3)} />
              <Stop offset="0.55" stopColor={base} />
              <Stop offset="1" stopColor={mix(base, "#000000", 0.18)} />
            </RadialGradient>
          </Defs>
        )}
        <G>
          {shape.ears && (
            <>
              <Circle cx={42} cy={52} r={16} fill={fill} />
              <Circle cx={118} cy={52} r={16} fill={fill} />
            </>
          )}
          <Path d={shape.d} fill={fill} />
          {shape.leaf && (
            <>
              <Path d="M80 40 C80 31 82 25 87 20" fill="none" stroke={deep} strokeWidth={6} strokeLinecap="round" />
              <Path d="M86 21 C89 9 102 3 117 6 C114 19 102 27 86 21 Z" fill={deep} />
            </>
          )}
          {detail && <Ellipse cx={60} cy={shape.top + 20} rx={18} ry={9} fill="#FFFFFF" opacity={0.26} />}
          <G transform={`translate(0 ${dy})`}>
            {face}
            {detail && mood === "waiting" && <Ellipse cx={80} cy={106} rx={4.5} ry={5.5} fill={ink} />}
            {detail && mood === "idle" && line("M73 104 Q80 108 87 104")}
            {detail && mood === "happy" && <Path d="M67 100 Q80 114 93 100 Z" fill={ink} />}
          </G>
        </G>
      </Svg>
    </View>
  );
}
