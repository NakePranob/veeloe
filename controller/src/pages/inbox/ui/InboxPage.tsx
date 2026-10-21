import { Redirect } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTasks } from "@/src/entities/task";
import { useWide } from "@/src/shared/lib";
import { Text } from "@/src/shared/ui";
import { AgentList } from "@/src/widgets/agent-list";

export function InboxPage() {
  const wide = useWide();
  const tasks = useTasks();
  const insets = useSafeAreaInsets();

  // On desktop the inbox is the sidebar, so the main pane opens what needs you.
  if (wide) {
    const target = tasks.find((task) => task.state === "waiting") ?? tasks[0];
    return target ? <Redirect href={`/agents/${target.agent}/tasks/${target.id}`} /> : null;
  }

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      <View className="min-h-[60px] flex-row items-center gap-2.5 px-4">
        <View className="bg-secondary size-[34px] items-center justify-center rounded-full">
          <Text className="text-xs font-bold">NL</Text>
        </View>
        <Text className="text-[17px] font-semibold">Nake Lab</Text>
      </View>
      <ScrollView>
        <View className="px-4 pb-8">
          <AgentList tileSize={68} />
        </View>
      </ScrollView>
    </View>
  );
}
