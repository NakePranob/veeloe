import { View } from "react-native";
import { Icon, space, Text, useSplit } from "../../../shared/ui";
import { AgentInbox } from "../../../widgets/agent-inbox";

export function InboxPage() {
  // In split view the inbox already sits in the sidebar, so this side waits for a choice, as Mail does.
  if (useSplit()) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm }}>
        <Icon name="inbox" size="xl" color="tertiaryLabel" />
        <Text tone="secondary">เลือก Agent ทางซ้ายเพื่อเปิด Task</Text>
      </View>
    );
  }
  return <AgentInbox />;
}
