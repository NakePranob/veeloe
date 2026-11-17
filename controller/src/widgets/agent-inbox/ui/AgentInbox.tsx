import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { FlatList, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { latestEvents, previewOf, useTaskSummaries, type TaskStatus, type TaskSummary } from "../../../entities/task";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Button, Empty, Tabs, Tap, Text, column, font, space } from "../../../shared/ui";
import { countsOf, inboxRows, rowsOf, type InboxTab } from "../model/inbox";

// The board's row: a 60pt head, the name, one line, and on the right the answer pill or the time.
const AVATAR = 60;

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

function InboxRow({ agent, machine, online, task, status, now, selected, replace }: RowProps) {
  const t = useT("agent-inbox");
  const language = useLanguage();
  // Tapping goes straight into the chat; an Agent with no Task yet gets an empty one.
  const open = () => {
    const href = { pathname: "/tasks/[task]", params: { task: task?.id ?? randomUUID(), agent: agent.id } } as const;
    if (replace) router.replace(href);
    else router.push(href);
  };
  const quiet = status === "working" || status === "offline";
  const line = status === "offline" ? t("offline", { machine }) : (task && previewOf(task)) || t("start", { name: agent.name });
  return (
    <Tap onPress={open} selected={selected} style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginHorizontal: 10, paddingHorizontal: space.md, paddingVertical: space.sm }}>
      {({ pressed }) => (
        <>
          <Character
            look={lookOfJson(agent.character)}
            mood={moodOf(task ? latestEvents(task) : [], online)}
            size={AVATAR}
            // What the row is painted with: the sidebar card in split view, else the screen.
            backdrop={pressed ? "chipPressed" : selected ? "chip" : replace ? "card" : "background"}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text strong numberOfLines={1} tone={status === "offline" ? "secondary" : "label"} style={{ fontFamily: font.bold }}>
              {agent.name}
            </Text>
            <Text variant="subheadline" tone={quiet ? "secondary" : "label"} numberOfLines={1} style={{ fontSize: 14 }}>
              {line}
            </Text>
          </View>
          {/* Waiting on an Approval: the answer is one tap away, as the board's pill says; the row opens the chat. */}
          {status === "waiting" ? (
            <View pointerEvents="none">
              <Button label={t("answer")} variant="primary" onPress={open} />
            </View>
          ) : task && task.events > 0 ? (
            <Text variant="caption" tone="secondary">
              {when(task.updated_at, language, now)}
            </Text>
          ) : null}
        </>
      )}
    </Tap>
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
  // Kept while the app is open; a fresh launch starts on All so no Agent is out of sight.
  const [tab, setTab] = useState<InboxTab>("all");
  if (machines === null || agents === null || tasks === null) return header ?? null;
  const machineName = new Map(machines.map((m) => [m.id, m.name]));
  const online = (machine: string) => statuses[machine]?.online ?? null;
  const rows = inboxRows(agents, tasks, online);
  const counts = countsOf(rows);
  const tabs =
    rows.length > 0 ? (
      <View style={{ paddingHorizontal: space.lg, paddingBottom: 14 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: t("tabs.all") },
            { value: "needsYou", label: t("tabs.needsYou"), count: counts.needsYou, urgent: true },
            { value: "working", label: t("tabs.working"), count: counts.working },
            { value: "done", label: t("tabs.done") },
          ]}
        />
      </View>
    ) : null;
  return (
    <FlatList
      // The page's own header pads for the status bar, so the list adds no inset of its own.
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[column, { paddingBottom: 40 }]}
      data={rowsOf(rows, tab)}
      keyExtractor={(row) => row.agent.id}
      ListHeaderComponent={
        <>
          {header}
          {tabs}
        </>
      }
      ListEmptyComponent={tab !== "all" ? <Empty icon="inbox" title={t(`emptyTab.${tab}`)} /> : <Empty icon="agent" title={t("noAgents.title")} detail={t("noAgents.body")} action={<Button label={t("noAgents.action")} variant="primary" onPress={() => router.push("/agents/new")} />} />}
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
