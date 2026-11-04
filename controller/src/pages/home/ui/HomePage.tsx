import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { previewOf, TaskStatusLabel, useTaskSummaries, type TaskStatus, type TaskSummary } from "../../../entities/task";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { AgentAvatar, Button, column, Empty, HeaderAction, Icon, radius, space, Text, useColors } from "../../../shared/ui";
import { inboxRows } from "../model/inbox";

const openTask = (agent: string, task?: string) => router.push({ pathname: "/tasks/[task]", params: { task: task ?? randomUUID(), agent } });

// Laid out like Mail: sender and time, a status line, then two lines of preview (controller-prototype's AgentInbox).
function InboxRow({ agent, machine, task, status, now }: { agent: AgentRow; machine: string; task?: TaskSummary; status: TaskStatus; now: number }) {
  const t = useT("home");
  const colors = useColors();
  const language = useLanguage();
  return (
    <Pressable role="button" onPress={() => openTask(agent.id, task?.id)}>
      {({ pressed }) => (
        // An inset rounded highlight, as in an iPadOS sidebar; content still lines up at space.lg.
        <View style={{ flexDirection: "row", gap: space.md, marginHorizontal: space.sm, paddingHorizontal: space.sm, paddingVertical: space.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: pressed ? colors.chipPressed : colors.background }}>
          <AgentAvatar backdrop={pressed ? "chip" : "fill"} />
          <View style={{ flex: 1, gap: space.xs / 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
                {agent.name}
              </Text>
              <Text variant="subheadline" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                {machine}
              </Text>
              {task && task.events > 0 && (
                <Text variant="subheadline" tone="secondary">
                  {when(task.updated_at, language, now)}
                </Text>
              )}
              <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />
            </View>
            <TaskStatusLabel status={status} />
            <Text variant="subheadline" tone="secondary" numberOfLines={2}>
              {(task && previewOf(task)) || t("start", { name: agent.name })}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export function HomePage() {
  const t = useT("home");
  const machines = useMachines();
  const agents = useAgents();
  const tasks = useTaskSummaries();
  const statuses = useMachineStatuses();
  const now = useNow();
  const header = (
    <>
      <Stack.Screen options={{ title: t("title") }} />
      <HeaderAction label="Workspace" icon="settings" onPress={() => router.navigate("/workspace")} />
    </>
  );

  if (machines === null || agents === null || tasks === null) return header;

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
          <Button label={t("add")} variant="primary" onPress={() => router.navigate("/add-machine")} />
        </View>
      </ScrollView>
    );
  }

  const machineName = new Map(machines.map((m) => [m.id, m.name]));
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={column}
      data={inboxRows(agents, tasks, (machine) => statuses[machine]?.online ?? null)}
      keyExtractor={(row) => row.agent.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<Empty icon="agent" title={t("noAgents.title")} detail={t("noAgents.body")} action={<Button label={t("noAgents.action")} variant="primary" onPress={() => router.push("/agents/new")} />} />}
      // No separators: rows are set apart by their spacing, not by lines.
      renderItem={({ item }) => <InboxRow agent={item.agent} machine={machineName.get(item.agent.machine_id) ?? ""} task={item.task} status={item.status} now={now} />}
    />
  );
}
