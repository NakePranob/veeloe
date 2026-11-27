import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { FlatList, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { isBudgetOut, latestEvents, previewOf, STATUS_DOT, titleOf, useLatestTasks, useOpenTasks, type TaskStatus, type TaskSummary } from "../../../entities/task";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Branch, Button, closeSwipes, Dot, Empty, Swipe, Tabs, Tap, Text, column, space, type SwipeAccess } from "../../../shared/ui";
import { countsOf, inboxRows, rowsOf, type InboxTab } from "../model/inbox";

// A row: a 60pt head; the name, its state in colour and its latest words; on the right the answer pill or the time.
const AVATAR = 60;

interface RowProps {
  agent: AgentRow;
  machine: string;
  online: boolean | null;
  task?: TaskSummary;
  status: TaskStatus;
  // The Agent's other open Tasks, each a line under the row (ADR 0080).
  open: { task: TaskSummary; status: TaskStatus }[];
  now: number;
  selected: boolean;
  // In split view a row replaces the open Task rather than stacking on it.
  replace?: boolean;
}

function InboxRow({ agent, machine, online, task, status, open: others, now, selected, selectedTaskId, replace, access }: RowProps & { selectedTaskId?: string; access: SwipeAccess }) {
  const t = useT("agent-inbox");
  const tStatus = useT("task-status");
  const language = useLanguage();
  // Tapping goes straight into the chat; an Agent with no Task yet gets an empty one.
  const go = (id: string) => {
    const href = { pathname: "/tasks/[task]", params: { task: id, agent: agent.id } } as const;
    if (replace) router.replace(href);
    else router.push(href);
  };
  const open = () => go(task?.id ?? randomUUID());
  // Today's Budget ran out: the state says so in red and the row offers the way out, the Agent's page.
  const budgetOut = status === "failed" && isBudgetOut(task);
  // An offline row names the Machine that is away; the state above it already says offline.
  const line = status === "offline" ? machine : (task && (previewOf(task) || titleOf(task))) || t("start", { name: agent.name });
  return (
    <View>
      <Tap onPress={open} selected={selected} {...access} style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginHorizontal: 10, paddingHorizontal: space.md, paddingVertical: space.sm }}>
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
              {/* The state is the dot before the name alone; its word is for VoiceOver. A Budget used up today is red. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View accessible aria-label={budgetOut ? tStatus("spent") : tStatus(status)}>
                  <Dot color={budgetOut ? "red" : STATUS_DOT[status]} />
                </View>
                <Text variant="rowTitle" numberOfLines={1} tone={status === "offline" ? "secondary" : "label"} style={{ flexShrink: 1 }}>
                  {agent.name}
                </Text>
              </View>
              {/* An answer not read yet (markRead) is in bold, as Mail sets an unread message. */}
              <Text variant="callout" tone={task?.unread ? "label" : "secondary"} strong={!!task?.unread} numberOfLines={1}>
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
      {others.map((other, index) => (
        <OpenTask key={other.task.id} task={other.task} status={other.status} first={index === 0} last={index === others.length - 1} selected={other.task.id === selectedTaskId} onPress={() => go(other.task.id)} />
      ))}
    </View>
  );
}

// One more open Task under an Agent's row, its words lined up with the name above: what it is, and its state or the answer pill.
// An Agent's other open Tasks hang off a line down from under its Character, each title on a small grey card,
// so the lines under one Agent read as a group. The branch stops short of the card and starts in the row
// above's bottom padding, so it meets the head.
const TRUNK = space.md + AVATAR / 2;

function OpenTask({ task, status, first, last, selected, onPress }: { task: TaskSummary; status: TaskStatus; first: boolean; last: boolean; selected: boolean; onPress: () => void }) {
  const t = useT("agent-inbox");
  const tStatus = useT("task-status");
  const unread = !!task.unread;
  const title = titleOf(task) || previewOf(task) || t("untitled");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginHorizontal: 10, paddingLeft: space.md + AVATAR + space.md, paddingRight: space.md, paddingVertical: space.xxs }}>
      <Branch x={TRUNK} reach={AVATAR / 2 + space.md - space.sm} rise={space.sm} first={first} last={last} />
      {/* Drawn short; hitSlop keeps the 44pt it takes to press. */}
      <Tap filled onPress={onPress} selected={selected} hitSlop={{ top: space.sm, bottom: space.sm }} style={{ paddingHorizontal: space.md, paddingVertical: space.xs }}>
        <Text variant="callout" strong={unread} numberOfLines={1} aria-label={unread ? t("unreadTitle", { title }) : undefined}>
          {title}
        </Text>
      </Tap>
      <View style={{ flex: 1 }} />
      {status === "waiting" ? (
        <Button label={t("answer")} variant="primary" size="small" onPress={onPress} />
      ) : (
        // The state as a dot alone, as on the Agent's row; its word is for VoiceOver.
        <View accessible aria-label={tStatus(status)}>
          <Dot color={STATUS_DOT[status]} />
        </View>
      )}
    </View>
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
  const tasks = useLatestTasks();
  const openTasks = useOpenTasks();
  const statuses = useMachineStatuses();
  const now = useNow();
  // Kept while the app is open; a fresh launch starts on All so no Agent is out of sight.
  const [tab, setTab] = useState<InboxTab>("all");
  if (machines === null || agents === null || tasks === null || openTasks === null) return header ?? null;
  const machineName = new Map(machines.map((m) => [m.id, m.name]));
  const online = (machine: string) => statuses[machine]?.online ?? null;
  const rows = inboxRows(agents, tasks, openTasks, online);
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
      // A row left open closes once the list moves.
      onScrollBeginDrag={closeSwipes}
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
          <Empty icon="inbox" title={t(`emptyTab.${tab}`)} headerless={split} />
        ) : (
          <Empty icon="agent" headerless={split} title={t("noAgents.title")} detail={t("noAgents.body")} action={<Button label={t("noAgents.action")} variant="primary" onPress={() => router.push("/agents/new")} />} />
        )
      }
      // No separators: rows are set apart by their spacing, not by lines.
      // Swiped left, a row offers all of the Agent's Tasks, a long swipe opening them, and a new Task.
      renderItem={({ item }) => (
        <Swipe
          actions={[
            { icon: "list", label: t("allTasks"), onPress: () => router.push({ pathname: "/agents/[agent]/all", params: { agent: item.agent.id, show: "tasks" } }) },
            { icon: "add", label: t("newTask"), onPress: () => router.push({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: item.agent.id } }) },
          ]}
        >
          {(access) => (
            <InboxRow
              agent={item.agent}
              machine={machineName.get(item.agent.machine_id) ?? ""}
              online={online(item.agent.machine_id)}
              task={item.task}
              status={item.status}
              open={item.open}
              now={now}
              selected={!!item.task && item.task.id === selectedTaskId}
              selectedTaskId={selectedTaskId}
              replace={split}
              access={access}
            />
          )}
        </Swipe>
      )}
    />
  );
}
