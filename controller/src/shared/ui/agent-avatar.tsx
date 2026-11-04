import { View } from "react-native";
import { Icon } from "./icon";
import { useColors, type Colors } from "./theme";

// ponytail: stands where the prototype draws the Agent's Character, which comes with `controller-task-screens`.
export function AgentAvatar({ size = 44, backdrop = "fill" }: { size?: number; backdrop?: keyof Colors }) {
  const colors = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors[backdrop === "fill" ? "fill" : "chip"] }}>
      <Icon name="agent" size={size >= 80 ? "lg" : "md"} />
    </View>
  );
}
