import { router, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { useMachines } from "../../../entities/machine";
import { useT } from "../../../shared/i18n";
import { Button, Card, column, HeaderAction, Icon, space, Text } from "../../../shared/ui";

const addMachine = () => router.navigate("/add-machine");

export function HomePage() {
  const t = useT("home");
  const machines = useMachines();
  const header = (
    <>
      <Stack.Screen options={{ title: t("title") }} />
      <HeaderAction label={t("settings")} icon="settings" onPress={() => router.navigate("/settings")} />
    </>
  );

  if (machines === null) return header;

  // Mail with no accounts: the screen says what will be here, and how to get it there.
  if (machines.length === 0) {
    return (
      // "automatic" adds the header's height on top of a container already as tall as the screen, which pushes centred content down on iOS.
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }}>
        {header}
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
          <Button label={t("add")} variant="primary" onPress={addMachine} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ gap: space.md, padding: space.lg, ...column }}>
      {header}
      {machines.map((machine) => (
        <Card key={machine.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Icon name="machine" size="md" />
          <View style={{ flex: 1 }}>
            <Text selectable strong>
              {machine.name}
            </Text>
            <Text selectable variant="footnote" tone="secondary">
              {machine.hub_url}
            </Text>
          </View>
        </Card>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "center" }}>
        <Button label={t("add")} onPress={addMachine} />
      </View>
    </ScrollView>
  );
}
