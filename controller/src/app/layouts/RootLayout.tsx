import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useGlobalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SIDEBAR_WIDTH, space, Text, useColors, useNavigationColors, useSplit } from "../../shared/ui";
import { AgentInbox } from "../../widgets/agent-inbox";

// Web draws its own header, Material-style by default; give it iOS's layout:
// a centred title and a chevron with the previous screen's name.
const CHEVRON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="13" height="22" viewBox="0 0 13 22"><path d="M11 2 2 11l9 9" fill="none" stroke="black" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')}`;
const webHeader =
  process.env.EXPO_OS === "web"
    ? ({ headerTitleAlign: "center", headerBackButtonDisplayMode: "default", headerBackIcon: { type: "image", source: { uri: CHEVRON } } } as const)
    : {};

// The inbox beside the open Task on an iPad or a wide window, as in Mail.
// ponytail: a plain title, not a second navigation stack; the sidebar never navigates on its own.
function Sidebar({ selectedTaskId }: { selectedTaskId?: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ width: SIDEBAR_WIDTH, paddingTop: insets.top, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator }}>
      <Text variant="largeTitle" style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs }}>
        Inbox
      </Text>
      <AgentInbox selectedTaskId={selectedTaskId} split />
    </View>
  );
}

export function RootLayout() {
  const colors = useColors();
  const nav = useNavigationColors();
  const split = useSplit();
  const { task } = useGlobalSearchParams<{ task?: string }>();
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: nav.background, card: nav.background, text: nav.label, border: nav.separator, primary: nav.blue } };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      {/* The Stack keeps its place in the tree either way, so resizing never resets navigation. */}
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
        {split && <Sidebar selectedTaskId={task} />}
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, ...webHeader }}>
            {/* The inbox is a list like Mail, so its title is large and shrinks as the list scrolls. */}
            <Stack.Screen name="index" options={split ? { headerShown: false } : { title: "Inbox", headerLargeTitleEnabled: true, headerShadowVisible: false }} />
            {/* In split view the inbox is already beside the Task, so there is nothing to go back to.
                Web ignores headerBackVisible when a deep link anchors the inbox underneath, hence headerLeft. */}
            <Stack.Screen name="tasks/[task]" options={split ? { headerBackVisible: false, headerLeft: () => null } : {}} />
          </Stack>
        </View>
      </View>
    </ThemeProvider>
  );
}
