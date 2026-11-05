import { router, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { useMachines } from "../../../entities/machine";
import { useT } from "../../../shared/i18n";
import { Button, HeaderAction, Icon, space, Text, useSplit } from "../../../shared/ui";
import { AgentInbox } from "../../../widgets/agent-inbox";

export function HomePage() {
  const t = useT("home");
  const machines = useMachines();
  const split = useSplit();
  const header = (
    <>
      <Stack.Screen options={{ title: t("title") }} />
      <HeaderAction label="Workspace" icon="settings" onPress={() => router.navigate("/workspace")} />
    </>
  );

  if (machines === null) return split ? null : header;

  // Mail with no accounts: the screen says what will be here, and how to get it there.
  if (machines.length === 0) {
    return (
      // "automatic" adds the header's height on top of a container already as tall as the screen, which pushes centred content down on iOS.
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }}>
        {!split && header}
        <View style={{ alignItems: "center", gap: space.lg }}>
          <View style={{ alignItems: "center", gap: space.sm }}>
            <Icon name="machine" size="xl" />
            <Text variant="headline" style={{ textAlign: "center" }}>
              {t("empty.title")}
            </Text>
            <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
              {t("empty.body")}
            </Text>
          </View>
          <Button label={t("add")} variant="primary" onPress={() => router.navigate("/add-machine")} />
        </View>
      </ScrollView>
    );
  }

  // In split view the inbox already sits in the sidebar, so this side waits for a choice, as Mail does.
  if (split) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl }}>
        <Icon name="inbox" size="xl" color="tertiaryLabel" />
        <Text tone="secondary" style={{ textAlign: "center" }}>
          {t("pick")}
        </Text>
      </View>
    );
  }

  return <AgentInbox header={header} />;
}
