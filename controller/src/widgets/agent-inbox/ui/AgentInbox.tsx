import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, FlatList, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { isBudgetOut, latestEvents, previewOf, TaskStatusDot, useTaskSummaries, type TaskStatus, type TaskSummary } from "../../../entities/task";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Button, Empty, Tabs, Tap, Text, column, space, useReduceMotion } from "../../../shared/ui";
import { countsOf, inboxRows, rowsOf, type InboxTab } from "../model/inbox";

// A row: a 60pt head; the name, its state in colour and its latest words; on the right the answer pill or the time.
const AVATAR = 60;

// The board's working line ends in three dots that pulse one after another; still when the device asks for less motion.
function Dots() {
  const reduce = useReduceMotion();
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 1200, useNativeDriver: true }));
    loop.start();
    return () => {
      loop.stop();
      phase.setValue(0);
    };
  }, [reduce, phase]);
  return (
    <>
      {[0, 0.2, 0.4].map((delay) => (
        <Animated.View
          key={delay}
          aria-hidden
          style={{ marginLeft: delay === 0 ? 4 : 0, opacity: reduce ? 1 : phase.interpolate({ inputRange: [0, delay, delay + 0.33, Math.min(1, delay + 0.66), 1], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }) }}
        >
          <Text variant="callout" tone="secondary">
            ●
          </Text>
        </Animated.View>
      ))}
    </>
  );
}

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
  // ponytail: the board's unread dot on a done row needs a read marker the database does not keep; add one with that column.
  // Tapping goes straight into the chat; an Agent with no Task yet gets an empty one.
  const open = () => {
    const href = { pathname: "/tasks/[task]", params: { task: task?.id ?? randomUUID(), agent: agent.id } } as const;
    if (replace) router.replace(href);
    else router.push(href);
  };
  // Today's Budget ran out: the state says so in red and the row offers the way out, the Agent's page.
  const budgetOut = status === "failed" && isBudgetOut(task);
  // An offline row names the Machine that is away; the state above it already says offline.
  const line = status === "offline" ? machine : (task && previewOf(task)) || t("start", { name: agent.name });
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
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text variant="rowTitle" numberOfLines={1} tone={status === "offline" ? "secondary" : "label"}>
              {agent.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TaskStatusDot status={status} spent={budgetOut} />
              {status === "working" && <Dots />}
            </View>
            <Text variant="callout" tone="secondary" numberOfLines={1}>
              {line}
            </Text>
          </View>
          {/* Waiting on an Approval: the answer is one tap away, as the board's pill says; the row opens the chat. */}
          {status === "waiting" ? (
            <View pointerEvents="none">
              <Button label={t("answer")} variant="primary" size="small" onPress={open} />
            </View>
          ) : budgetOut ? (
            <Button label={t("addBudget")} size="small" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />
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
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.inset }}>
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
      contentContainerStyle={[column, { flexGrow: 1, paddingBottom: 40 }]}
      data={rowsOf(rows, tab)}
      keyExtractor={(row) => row.agent.id}
      ListHeaderComponent={
        <>
          {header}
          {tabs}
        </>
      }
      ListEmptyComponent={
        tab !== "all" ? (
          <Empty icon="inbox" title={t(`emptyTab.${tab}`)} />
        ) : (
          <Empty icon="agent" title={t("noAgents.title")} detail={t("noAgents.body")} action={<Button label={t("noAgents.action")} variant="primary" onPress={() => router.push("/agents/new")} />} />
        )
      }
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
