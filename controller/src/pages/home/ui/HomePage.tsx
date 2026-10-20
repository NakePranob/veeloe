import { PROTOCOL_VERSION } from "@veeloe/protocol";
import { Text, View } from "react-native";

export function HomePage() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Veeloe, protocol v{PROTOCOL_VERSION}</Text>
    </View>
  );
}
