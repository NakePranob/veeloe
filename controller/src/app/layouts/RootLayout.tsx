import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useGlobalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CreateKeyPage } from "../../pages/create-key";
import { LockPage } from "../../pages/lock";
import { StorageUnavailablePage } from "../../pages/storage-unavailable";
import { listDevices } from "../../entities/device";
import { pruneQuietRounds } from "../../entities/task";
import { useMachineLinks } from "../../features/machine-link";
import { DatabaseProvider, useDatabase } from "../../shared/db";
import { deviceLanguage, initI18n, useT } from "../../shared/i18n";
import { useKeyActivity, useKeyStatus } from "../../shared/keystore";
import { Button, Card, inform, SIDEBAR_WIDTH, space, Text, useAppFonts, useColors, useSplit } from "../../shared/ui";
import { AgentInbox } from "../../widgets/agent-inbox";
import { resources } from "../i18n/resources";
import { forgetThisDevice } from "./forget-device";
import { useAppDatabase } from "./use-app-database";

// The Character editor slides up over the Agent's page, as in the prototype. Android's sheet draws
// no header, so Cancel and Done would be lost: there it is a modal.
const sheet = process.env.EXPO_OS === "android" ? ({ presentation: "modal", animation: "slide_from_bottom" } as const) : ({ presentation: "formSheet" } as const);

// Before anything draws. The saved language replaces it once the database opens.
initI18n(resources, deviceLanguage());

// Keeps every Hub connected while the key is open. Needs the database, so it sits inside the provider.
// It also wipes this device when a Hub says its key was revoked, and tells the Owner when another of their devices linked one.
function MachineLinks() {
  const t = useT("devices");
  const database = useDatabase();
  // Old quiet Schedule rounds give their logs back once per launch; the Tasks stay listed.
  useEffect(() => {
    void pruneQuietRounds(database);
  }, [database]);
  useMachineLinks({
    onRevoked: () => void forgetThisDevice(database).then(() => inform(t("revoked.title"), t("revoked.body"))),
    // ponytail: an alert in the app stands in for the push the prototype shows, until there is push (ADR 0044).
    onLinked: (links) =>
      void listDevices(database).then((devices) => {
        for (const link of links) inform(t("linked.title"), t("linked.body", { name: link.name, by: devices.find((d) => d.key === link.by)?.name || t("firstDevice") }));
      }),
  });
  return null;
}

// The inbox beside the open Task on an iPad or a wide window, as in Mail: a card
// floating on the grey screen, no divider line.
// ponytail: a plain title, not a second navigation stack; the sidebar never navigates on its own.
function Sidebar({ selectedTaskId }: { selectedTaskId?: string }) {
  const t = useT("agent-inbox");
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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>
        <Text variant="largeTitle">{t("title")}</Text>
        <Button label="Workspace" icon="settings" onPress={() => router.navigate("/workspace")} />
      </View>
      <AgentInbox selectedTaskId={selectedTaskId} split />
    </Card>
  );
}

export function RootLayout() {
  const colors = useColors();
  const split = useSplit();
  const { task } = useGlobalSearchParams<{ task?: string }>();
  const keyStatus = useKeyStatus();
  const trackActivity = useKeyActivity();
  const { state, retry } = useAppDatabase();
  // Nothing with text draws until the bundled fonts are in, so no screen changes font after it shows.
  const fontsReady = useAppFonts();
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.label, border: colors.separator, primary: colors.accent } };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      {/* In place of the Stack rather than a route, so the URL is still there afterwards. */}
      {!fontsReady ? (
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      ) : state.status === "ready" ? (
        <DatabaseProvider value={state.database}>
          <MachineLinks />
          {/* The Stack stays mounted but hidden while locked, so unlocking returns to the same page. */}
          <View onTouchStartCapture={trackActivity} style={{ flex: 1, display: keyStatus === "unlocked" ? "flex" : "none" }}>
            {/* The Stack keeps its place in the tree either way, so resizing never resets navigation. */}
            <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
              {split && <Sidebar selectedTaskId={task} />}
              <View style={{ flex: 1 }}>
                <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTitleAlign: "center", headerBackButtonDisplayMode: "minimal" }}>
                  <Stack.Screen name="index" options={split ? { headerShown: false } : {}} />
                  {/* In split view the inbox is already beside the Task, so there is nothing to go back to. */}
                  <Stack.Screen name="tasks/[task]/index" options={split ? { headerBackVisible: false, headerLeft: () => null } : {}} />
                  <Stack.Screen name="agents/[agent]/character" options={sheet} />
                  <Stack.Screen name="agents/[agent]/schedule/[trigger]" options={sheet} />
                  <Stack.Screen name="agents/[agent]/idle/[piece]" options={sheet} />
                  <Stack.Screen name="agents/[agent]/all" options={{ ...sheet, sheetGrabberVisible: true }} />
                  {/* The Task details sheet has no header: the grabber and the swipe close it, as the board draws it. */}
                  <Stack.Screen name="tasks/[task]/details" options={{ ...sheet, headerShown: false, sheetGrabberVisible: true }} />
                </Stack>
              </View>
            </View>
          </View>
          {keyStatus === "locked" && <LockPage />}
          {(keyStatus === "none" || keyStatus === "lost") && <CreateKeyPage lost={keyStatus === "lost"} />}
          {keyStatus === "checking" && <View style={{ flex: 1, backgroundColor: colors.background }} />}
        </DatabaseProvider>
      ) : state.status === "failed" ? (
        <StorageUnavailablePage onRetry={retry} />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      )}
    </ThemeProvider>
  );
}
