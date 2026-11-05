import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { latestEvents, previewOf, TaskStatusLabel, useTaskSummaries, type TaskStatus, type TaskSummary } from "../../../entities/task";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Button, column, Empty, Icon, radius, space, Text, useColors } from "../../../shared/ui";
import { inboxRows } from "../model/inbox";

const AVATAR = 44;

interface RowProps {
  agent: AgentRow;
  machine: string;
  online: boolean | null;
  task?: TaskSummary;
  status: TaskStatus;
  now: number;
  selected: boolean;
  // In split view a row replaces the open Task rather than stacking on it.
  replace?: boolean;
}

// Laid out like Mail: sender and time, a status line, then two lines of preview.
function InboxRow({ agent, machine, online, task, status, now, selected, replace }: RowProps) {
  const t = useT("agent-inbox");
  const colors = useColors();
  const language = useLanguage();
  // Tapping goes straight into the chat; an Agent with no Task yet gets an empty one.
  const open = () => {
    const href = { pathname: "/tasks/[task]", params: { task: task?.id ?? randomUUID(), agent: agent.id } } as const;
    if (replace) router.replace(href);
    else router.push(href);
  };
  return (
    <Pressable role="button" aria-selected={selected} onPress={open}>
      {({ pressed }) => (
        // An inset rounded highlight, as in an iPadOS sidebar, so it sits inside the card's
        // curve rather than cutting across it; content still lines up at space.lg.
        <View
          style={{
            flexDirection: "row",
            gap: space.md,
            marginHorizontal: space.sm,
            paddingHorizontal: space.sm,
            paddingVertical: space.md,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            // What the row is painted with: the sidebar card in split view, else the screen.
            backgroundColor: colors[pressed ? "chipPressed" : selected ? "chip" : replace ? "surface" : "background"],
          }}
        >
          <Character look={lookOfJson(agent.character)} mood={moodOf(task ? latestEvents(task) : [], online)} size={AVATAR} />
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
              {!replace && <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />}
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

interface Props {
  // What sits above the rows, such as the screen's header actions.
  header?: ReactNode;
  // In split view the open Task is highlighted and a row replaces it rather than stacking.
  selectedTaskId?: string;
  split?: boolean;
}

// One row per Agent, the working ones first. A row opens the Agent's latest Task.
export function AgentInbox({ header, selectedTaskId, split }: Props) {
  const t = useT("agent-inbox");
  const machines = useMachines();
  const agents = useAgents();
  const tasks = useTaskSummaries();
  const statuses = useMachineStatuses();
  const now = useNow();
  if (machines === null || agents === null || tasks === null) return header ?? null;
  const machineName = new Map(machines.map((m) => [m.id, m.name]));
  const online = (machine: string) => statuses[machine]?.online ?? null;
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={column}
      data={inboxRows(agents, tasks, online)}
      keyExtractor={(row) => row.agent.id}
      ListHeaderComponent={<>{header}</>}
      ListEmptyComponent={<Empty icon="agent" title={t("noAgents.title")} detail={t("noAgents.body")} action={<Button label={t("noAgents.action")} variant="primary" onPress={() => router.push("/agents/new")} />} />}
      // No separators: rows are set apart by their spacing, not by lines.
      renderItem={({ item }) => (
        <InboxRow
          agent={item.agent}
          machine={machineName.get(item.agent.machine_id) ?? ""}
          online={online(item.agent.machine_id)}
          task={item.task}
          status={item.status}
          now={now}
          selected={!!item.task && item.task.id === selectedTaskId}
          replace={split}
        />
      )}
    />
  );
}
