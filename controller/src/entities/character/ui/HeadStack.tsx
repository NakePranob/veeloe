import { View } from "react-native";
import { space, Text, useColors } from "../../../shared/ui";
import type { Look } from "../model/look";
import type { Mood } from "../model/mood";
import { Character } from "./Character";

const HEAD = 34;

/** A few heads overlapping on a grey tile, the rest counted in a white circle after them (the Machine board's Agent tile). */
export function HeadStack({ looks, max = 3 }: { looks: { id: string; look: Look; mood: Mood }[]; max?: number }) {
  const colors = useColors();
  const rest = looks.length - max;
  return (
    <View aria-hidden style={{ height: 44, flexDirection: "row", alignItems: "flex-end" }}>
      {looks.slice(0, max).map((head, i) => (
        <View key={head.id} style={{ marginLeft: i ? -10 : 0 }}>
          <Character look={head.look} mood={head.mood} size={HEAD} backdrop="card" />
        </View>
      ))}
      {rest > 0 && (
        <View style={{ marginLeft: -space.smd, width: HEAD, height: HEAD, borderRadius: HEAD / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
          <Text variant="caption" strong tone="body">{`+${rest}`}</Text>
        </View>
      )}
    </View>
  );
}
