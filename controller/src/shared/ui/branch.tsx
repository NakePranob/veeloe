import { View } from "react-native";
import { radius, useColors } from "./theme";

const LINE = 1.5;

/**
 * One step of a tree drawn down the side of a list: the trunk going on past this row, and a rounded
 * elbow into it at its middle. The last row has the elbow only, which ends the line. `x` is where the
 * trunk runs, `reach` how far the elbow goes, and `rise` how far up into the row above the first one starts,
 * so the line meets what it hangs from. The row it sits in is the one positioned.
 */
export function Branch({ x, reach, rise = 0, first, last }: { x: number; reach: number; rise?: number; first: boolean; last: boolean }) {
  const colors = useColors();
  const top = first ? -rise : 0;
  return (
    <>
      {!last && <View aria-hidden style={{ position: "absolute", left: x, top, bottom: 0, width: LINE, backgroundColor: colors.track }} />}
      <View
        aria-hidden
        style={{
          position: "absolute",
          left: x,
          top,
          bottom: "50%",
          width: reach,
          borderLeftWidth: LINE,
          borderBottomWidth: LINE,
          borderColor: colors.track,
          borderBottomLeftRadius: radius.sm,
        }}
      />
    </>
  );
}
