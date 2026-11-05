import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { space, useColors } from "../../../shared/ui";

/** How far the fade reaches up the log; the log's end rests clear of it. */
export const FADE = space.xl + space.sm;

// The log fades out into the screen's colour above the composer, instead of being cut at a straight edge.
// Zero height, so it takes no room and draws upward over the end of the log.
export function LogFade() {
  const colors = useColors();
  return (
    <View style={{ height: 0, pointerEvents: "none" }}>
      <Svg width="100%" height={FADE} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Defs>
          <LinearGradient id="log-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.background} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#log-fade)" />
      </Svg>
    </View>
  );
}
