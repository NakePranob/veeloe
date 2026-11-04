import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useAgentTasks } from "../../../entities/task";
import { useT } from "../../../shared/i18n";
import { Button, Card, column, Icon, space, Text, useColors } from "../../../shared/ui";

const openTask = (agent: string, task: string) => router.push({ pathname: "/task/[task]", params: { task, agent } });

// One Agent's page: its Tasks first, newest at the top, then (later) its settings.
export function AgentPage() {
  const t = useT("agent");
  const colors = useColors();
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === agentId);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  const tasks = useAgentTasks(agentId);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { padding: space.lg, gap: space.sm }]}>
      <Stack.Screen options={{ title: agent?.name ?? "" }} />
      {agent && machine && (
        <Text variant="footnote" tone="secondary" style={{ textAlign: "center", paddingBottom: space.sm }}>
          {t("on", { machine: machine.name, model: agent.model })}
        </Text>
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg }}>
        <Text variant="footnote" tone="secondary">
          {t("tasks")}
        </Text>
        <Button label={t("newTask")} onPress={() => openTask(agentId, randomUUID())} />
      </View>
      {tasks && tasks.length > 0 && (
        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          {tasks.map((task, i) => (
            <Pressable
              key={task.id}
              role="button"
              onPress={() => openTask(agentId, task.id)}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                backgroundColor: pressed ? colors.chipPressed : "transparent",
                borderTopWidth: i ? 0.5 : 0,
                borderTopColor: colors.separator,
              })}
            >
              <Text numberOfLines={2} style={{ flex: 1 }} tone={task.preview ? "label" : "secondary"}>
                {task.preview ?? t("untitled")}
              </Text>
              <Icon name="chevron" color="tertiaryLabel" />
            </Pressable>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
