import { router, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { useT } from "../../../shared/i18n";
import { HeaderAction, Icon, space, Text } from "../../../shared/ui";

// Mail with no accounts: the screen says what will be here, and nothing else yet.
export function HomePage() {
  const t = useT("home");
  return (
    // "automatic" adds the header's height on top of a container already as tall as the screen, which pushes centred content down on iOS.
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }}>
      <Stack.Screen options={{ title: t("title") }} />
      <HeaderAction label={t("settings")} icon="settings" onPress={() => router.navigate("/settings")} />
      <View style={{ alignItems: "center", gap: space.sm }}>
        <Icon name="machine" size="xl" />
        <Text variant="headline" style={{ textAlign: "center" }}>
          {t("empty.title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("empty.body")}
        </Text>
      </View>
    </ScrollView>
  );
}
