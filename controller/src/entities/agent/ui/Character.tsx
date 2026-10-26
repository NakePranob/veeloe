import { View } from "react-native";
import { useColors, type Colors } from "../../../shared/ui";

// What the Agent is doing, as the Task entity reports it. Mood follows from it
// here and only here, never from the LLM (CONTEXT.md).
type Status = "waiting" | "working" | "done" | "offline";

const MOOD = { waiting: "waiting", working: "working", done: "happy", offline: "off" } as const;

interface Props {
  color: string;
  status: Status;
  size?: number;
  // What it sits on, so the ring around the raised hand reads as a cut-out, not an outline.
  backdrop?: keyof Colors;
}

const FACE = "#1C1917";

// ponytail: a face drawn from Views, enough to show Mood; the real Characters are artwork.
export function Character({ color, status, size = 44, backdrop = "background" }: Props) {
  const colors = useColors();
  const mood = MOOD[status];
  const eye = size * 0.1;
  const off = mood === "off";
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: off ? colors.chipPressed : color, alignItems: "center", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", gap: size * 0.2, marginBottom: size * 0.08 }}>
        {[0, 1].map((i) => (
          <View key={i} style={{ width: eye, height: off ? 2 : eye, borderRadius: eye, backgroundColor: off ? colors.tertiaryLabel : FACE }} />
        ))}
      </View>
      {mood === "happy" && (
        <View style={{ width: size * 0.3, height: size * 0.12, borderBottomWidth: 2, borderColor: FACE, borderBottomLeftRadius: size, borderBottomRightRadius: size }} />
      )}
      {mood === "working" && <View style={{ width: size * 0.18, height: 2, backgroundColor: FACE }} />}
      {mood === "waiting" && (
        <>
          <View style={{ width: size * 0.14, height: size * 0.14, borderRadius: size, borderWidth: 2, borderColor: FACE }} />
          {/* A raised hand: the one bit of colour that means a person is needed now. */}
          <View
            style={{
              position: "absolute",
              right: -size * 0.06,
              top: -size * 0.06,
              width: size * 0.34,
              height: size * 0.34,
              borderRadius: size,
              borderWidth: 2,
              backgroundColor: colors.orange,
              borderColor: colors[backdrop],
            }}
          />
        </>
      )}
    </View>
  );
}
