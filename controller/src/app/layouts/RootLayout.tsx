import { DarkTheme, DefaultTheme, Slot, Stack, ThemeProvider, router, useGlobalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ScrollView, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { cn, usePanel, useWide } from "@/src/shared/lib";
import { Text } from "@/src/shared/ui";
import { AgentList } from "@/src/widgets/agent-list";
import { AgentPanel } from "@/src/widgets/agent-panel";

// Desktop and tablet: the inbox as a sidebar, the open route in the middle, the Agent panel on the right.
function ThreePanes() {
  const { agent, task } = useGlobalSearchParams<{ agent?: string; task?: string }>();
  const panel = usePanel();
  return (
    <View className="bg-background flex-1 flex-row">
      <View className="border-sidebar-border bg-sidebar w-80 border-r">
        <View className="min-h-16 flex-row items-center gap-2.5 px-4">
          <View className="bg-sidebar-accent size-[34px] items-center justify-center rounded-full">
            <Text className="text-xs font-bold">NL</Text>
          </View>
          <Text className="text-[17px] font-semibold">Nake Lab</Text>
        </View>
        <ScrollView>
          <View className="px-3 pb-6">
            <AgentList tileSize={56} />
          </View>
        </ScrollView>
      </View>
      <View className="flex-1">
        <Slot />
      </View>
      {panel.open && agent && task && (
        // Floating only below 1280, so only then does it cast a shadow (and never in dark).
        <View className={cn("border-border w-[340px] border-l", panel.floating ? "bg-card absolute top-0 right-0 bottom-0 shadow-xl shadow-black/15 dark:shadow-none" : "bg-background")}>
          <AgentPanel agentId={agent} taskId={task} onClose={() => router.setParams({ panel: "0" })} />
        </View>
      )}
    </View>
  );
}

export function RootLayout() {
  const wide = useWide();
  const { theme } = useUniwind();
  const background = String(useCSSVariable("--color-background"));
  const base = theme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background } }}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {wide ? <ThreePanes /> : <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }} />}
    </ThemeProvider>
  );
}
