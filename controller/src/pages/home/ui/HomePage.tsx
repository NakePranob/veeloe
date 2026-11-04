import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { latestTaskOf } from "../../../entities/task";
import { useMachineStatus } from "../../../features/machine-link";
import { useDatabase, type Database } from "../../../shared/db";
import { useT } from "../../../shared/i18n";
import { Button, Card, column, HeaderAction, Icon, space, Text, useColors } from "../../../shared/ui";

const addMachine = () => router.navigate("/add-machine");

// Tapping an Agent goes straight to its chat: the latest Task, or a new one.
async function openAgent(database: Database, agent: string) {
  const task = (await latestTaskOf(database, agent)) ?? randomUUID();
  router.push({ pathname: "/task/[task]", params: { task, agent } });
}

function MachineCard({ machine, agents }: { machine: Machine; agents: AgentRow[] }) {
  const t = useT("home");
  const colors = useColors();
  const database = useDatabase();
  const status = useMachineStatus(machine.id);
  return (
    <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}>
        <Icon name="machine" size="md" />
        <View style={{ flex: 1 }}>
          <Text selectable strong>
            {machine.name}
          </Text>
          <Text selectable variant="footnote" tone="secondary">
            {status.online === false ? t("offline") : machine.hub_url}
          </Text>
        </View>
        <Button label={t("addAgent")} icon="add" onPress={() => router.push({ pathname: "/machine/[machine]/add-agent", params: { machine: machine.id } })} />
      </View>
      {agents.length === 0 ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          {t("noAgents")}
        </Text>
      ) : (
        agents.map((agent) => (
          <Pressable
            key={agent.id}
            role="button"
            onPress={() => void openAgent(database, agent.id)}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              backgroundColor: pressed ? colors.chipPressed : "transparent",
              borderTopWidth: 0.5,
              borderTopColor: colors.separator,
            })}
          >
            <Icon name="agent" />
            <View style={{ flex: 1 }}>
              <Text>{agent.name}</Text>
              <Text variant="caption" tone="secondary">
                {agent.model}
              </Text>
            </View>
            <Icon name="chevron" color="tertiaryLabel" />
          </Pressable>
        ))
      )}
    </Card>
  );
}

export function HomePage() {
  const t = useT("home");
  const machines = useMachines();
  const agents = useAgents();
  const header = (
    <>
      <Stack.Screen options={{ title: t("title") }} />
      <HeaderAction label={t("settings")} icon="settings" onPress={() => router.navigate("/settings")} />
    </>
  );

  if (machines === null || agents === null) return header;

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
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { gap: space.md, padding: space.lg }]}>
      {header}
      {machines.map((machine) => (
        <MachineCard key={machine.id} machine={machine} agents={agents.filter((a) => a.machine_id === machine.id)} />
      ))}
      <View style={{ flexDirection: "row", justifyContent: "center" }}>
        <Button label={t("add")} onPress={addMachine} />
      </View>
    </ScrollView>
  );
}
