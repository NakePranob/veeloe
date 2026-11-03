import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme, View } from "react-native";
import { CreateKeyPage } from "../../pages/create-key";
import { LockPage } from "../../pages/lock";
import { OtherTabPage } from "../../pages/other-tab";
import { StorageUnavailablePage } from "../../pages/storage-unavailable";
import { DatabaseProvider } from "../../shared/db";
import { deviceLanguage, initI18n } from "../../shared/i18n";
import { useKeyActivity, useKeyStatus } from "../../shared/keystore";
import { space, useColors } from "../../shared/ui";
import { resources } from "../i18n/resources";
import "../styles/web-reset";
import { useAppDatabase } from "./use-app-database";

// Web draws its own header, with our button right against the screen's edge.
const webHeader = process.env.EXPO_OS === "web" ? { headerRightContainerStyle: { paddingRight: space.lg } } : {};

// Before anything draws. The saved language replaces it once the database opens.
initI18n(resources, deviceLanguage());

export function RootLayout() {
  const colors = useColors();
  const keyStatus = useKeyStatus();
  const trackActivity = useKeyActivity();
  const { state, useHere, retry } = useAppDatabase();
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.label, border: colors.separator, primary: colors.accent } };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      {/* In place of the Stack rather than a route, so the URL is still there afterwards. */}
      {state.status === "ready" ? (
        <DatabaseProvider value={state.database}>
          {/* The Stack stays mounted but hidden while locked, so unlocking returns to the same page. */}
          <View onTouchStartCapture={trackActivity} style={{ flex: 1, display: keyStatus === "unlocked" ? "flex" : "none" }}>
            <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTitleAlign: "center", ...webHeader }} />
          </View>
          {keyStatus === "locked" && <LockPage />}
          {(keyStatus === "none" || keyStatus === "lost") && <CreateKeyPage lost={keyStatus === "lost"} />}
          {keyStatus === "checking" && <View style={{ flex: 1, backgroundColor: colors.background }} />}
        </DatabaseProvider>
      ) : state.status === "elsewhere" ? (
        <OtherTabPage onUseHere={() => void useHere()} />
      ) : state.status === "failed" ? (
        <StorageUnavailablePage onRetry={retry} />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      )}
    </ThemeProvider>
  );
}
