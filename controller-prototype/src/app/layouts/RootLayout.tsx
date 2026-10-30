import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useGlobalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, SIDEBAR_WIDTH, space, Text, useColors, useSplit } from "../../shared/ui";
import { AgentInbox } from "../../widgets/agent-inbox";
import "../styles/web-reset";

// Web draws its own header, Material-style by default; give it iOS's chevron
// with the previous screen's name.
const CHEVRON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="13" height="22" viewBox="0 0 13 22"><path d="M11 2 2 11l9 9" fill="none" stroke="black" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')}`;
const webHeader =
  process.env.EXPO_OS === "web" ? ({ headerBackButtonDisplayMode: "default", headerBackIcon: { type: "image", source: { uri: CHEVRON } } } as const) : {};

// Android's sheet draws no header, so Cancel and Done would be lost: there the
// editor is a full-screen dialog sliding up, as Material's editors are.
const sheet = process.env.EXPO_OS === "android" ? ({ presentation: "modal", animation: "slide_from_bottom" } as const) : ({ presentation: "formSheet" } as const);

// The inbox beside the open Task on an iPad or a wide window, as in Mail: a card
// floating on the grey screen, no divider line.
// ponytail: a plain title, not a second navigation stack; the sidebar never navigates on its own.
function Sidebar({ selectedTaskId }: { selectedTaskId?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Card
      style={{
        width: SIDEBAR_WIDTH,
        marginTop: insets.top + space.md,
        marginBottom: insets.bottom + space.md,
        marginLeft: insets.left + space.md,
        padding: 0,
        gap: 0,
        // Clips the list to the card's corners as it scrolls.
        overflow: "hidden",
      }}
    >
      <Text variant="largeTitle" style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>
        Inbox
      </Text>
      <AgentInbox selectedTaskId={selectedTaskId} split />
    </Card>
  );
}

export function RootLayout() {
  const colors = useColors();
  const split = useSplit();
  const { task } = useGlobalSearchParams<{ task?: string }>();
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.label, border: colors.separator, primary: colors.accent } };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      {/* The Stack keeps its place in the tree either way, so resizing never resets navigation. */}
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
        {split && <Sidebar selectedTaskId={task} />}
        <View style={{ flex: 1 }}>
          {/* No line under the header: the brand sets things apart by space and shadow, not borders.
              Titles sit in the middle on every platform, as iOS puts them; Android and web start them on the left. */}
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTitleAlign: "center", ...webHeader }}>
            {/* A plain title, as on the Task screen and on web, so the list starts right under the header;
                a large title would leave an empty bar above it, since the inbox has no header buttons. */}
            <Stack.Screen name="index" options={split ? { headerShown: false } : { title: "Inbox" }} />
            {/* In split view the inbox is already beside the Task, so there is nothing to go back to.
                Web ignores headerBackVisible when a deep link anchors the inbox underneath, hence headerLeft. */}
            <Stack.Screen name="tasks/[task]" options={split ? { headerBackVisible: false, headerLeft: () => null } : {}} />
            {/* Slides up over the Task; on web, where the stack shows one screen, it is a page. */}
            <Stack.Screen name="agents/[agent]/character" options={sheet} />
          </Stack>
        </View>
      </View>
    </ThemeProvider>
  );
}
