import { View } from "react-native";
import { radius, useColors, type Colors } from "./theme";

// A theme colour by name, or an Agent's own colour (data, not a token).
type Paint = keyof Colors | `#${string}`;

function usePaint() {
  const colors = useColors();
  return (paint: Paint) => (paint.startsWith("#") ? paint : colors[paint as keyof Colors]);
}

interface Props {
  parts: { key: string; value: number; color: Paint }[];
  total: number;
  // Where a line marks the whole, 0 to 1 (the Runtime's compaction point).
  mark?: number;
  // What a screen reader says for the whole bar.
  label: string;
}

// One bar split into the parts of a whole, the rest left as the track: where a Task's context goes.
export function PartsBar({ parts, total, mark, label }: Props) {
  const colors = useColors();
  const paint = usePaint();
  return (
    <View role="img" aria-label={label} style={{ height: 12, borderRadius: radius.sm, overflow: "hidden", flexDirection: "row", backgroundColor: colors.track }}>
      {parts.map((part) => (
        <View key={part.key} style={{ width: `${(part.value / total) * 100}%`, backgroundColor: paint(part.color) }} />
      ))}
      {mark !== undefined && <View style={{ position: "absolute", left: `${mark * 100}%`, top: 0, bottom: 0, width: 2, backgroundColor: colors.label }} />}
    </View>
  );
}

// The square beside a part's row, in the part's colour.
export function PartKey({ color }: { color: Paint | "track" }) {
  const paint = usePaint();
  return <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: paint(color) }} />;
}
