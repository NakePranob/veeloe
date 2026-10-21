import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/src/shared/i18n";
import { Button, Icon } from "@/src/shared/ui";
import { AgentPanel } from "@/src/widgets/agent-panel";

// On the phone the Agent panel is a screen of its own, opened from the Task header.
export function AgentPage() {
  const { agent, task } = useLocalSearchParams<{ agent: string; task?: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      <View className="min-h-[52px] flex-row items-center px-2">
        <Button variant="ghost" size="icon" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} accessibilityLabel={t("back")}>
          <Icon as={ChevronLeft} className="size-6" />
        </Button>
      </View>
      <AgentPanel agentId={agent} taskId={task} />
    </View>
  );
}
