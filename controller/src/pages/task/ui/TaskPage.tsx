import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlatList, KeyboardAvoidingView, View, type TextInputInstance } from "react-native";
import { allowlistOf, deletedAgent, useAgents, useTrashedAgents } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { latestOf, statusOf, usePendingMessages, useTaskEvents, useTaskRow } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { useNow } from "../../../shared/lib";
import { Bubble, Card, column, Fade, FADE, HeaderAction, radius, space, Spinner, Text } from "../../../shared/ui";
import { contextUsageOf, items, type Item, type ToolCall } from "../model/items";
import { useComposer } from "../model/use-composer";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { Composer } from "./Composer";
import { BudgetCard, CompactedCard, FailedCard, FileCard, InterruptedCard, Separator, StoppedLine } from "./LogCards";
import { PendingBubble } from "./PendingBubble";
import { TaskTitle } from "./TaskTitle";
import { ChangesRow, ToolCalls } from "./ToolCalls";

/** How close to the end of the log, in points, still counts as reading the end. */
const FOLLOW_END_PT = 80;

// Laid out like Messages: your messages in accent bubbles on the right. The
// Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const insets = useSafeAreaInsets();
  const t = useT("task");
  const { task, agent: agentId } = useLocalSearchParams<{ task: string; agent: string }>();
  const agents = useAgents();
  const trashedAgents = useTrashedAgents();
  const found = agents?.find((a) => a.id === agentId);
  // A deleted Agent still names its Tasks while it waits in the trash (`agent-trash`).
  const gone = trashedAgents?.find((a) => a.id === agentId);
  // Sending, Stop and settings need the Agent itself; the history does not.
  const row = useTaskRow(task)?.[0];
  const agent = found ?? deletedAgent(agentId, gone?.machine_id ?? row?.machine_id, gone?.name ?? t("deletedAgent"));
  const machines = useMachines();
  const machine = machines?.find((m) => m.id === agent.machine_id);
  const readOnly = !found;
  const status = useMachineStatus(machine?.id ?? "");
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const pending = usePendingMessages(task);
  const now = useNow();
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<FlatList<Item>>(null);
  const viewport = useRef(0);
  // Whether the reader is at the end of the log, so new content follows only then. Only the reader's own
  // scrolling changes it: a scroll the page makes (to the end, mid-animation, while a card grows below)
  // must never read as "they scrolled up", or what arrives next is left off screen.
  const atEnd = useRef(true);
  const dragging = useRef(false);
  // Whoever sends wants to see the message land, even after scrolling up to read: follow the end again.
  const followEnd = () => {
    atEnd.current = true;
    scroll.current?.scrollToEnd({ animated: true });
  };
  const composer = useComposer({ task, agent, machine, link, readOnly, events: events ?? undefined, stopError: status.stopError, onSend: followEnd });
  // The log only changes with its events; the clock matters only while an Approval is open and can still time out.
  const settled = useMemo(() => (events ? items(events, Date.now()) : null), [events]);
  const ticking = !!settled?.items.some((item) => item.kind === "approval" && item.approval.status === "open");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ticking && now` makes the clock a dependency only while it can change the log
  const log = useMemo(() => (events && ticking ? items(events, now) : settled), [events, ticking, ticking && now, settled]);

  // Until both lists land, neither "an Agent" nor "a deleted Agent" is known yet:
  // showing the deleted state here would flash a wrong name and no composer.
  // A Machine no longer paired (or a deleted Agent's unknown one) still shows the log, read from the device.
  if (!agents || !trashedAgents || !machines || !events || !pending || !log) return <Stack.Screen options={{ title: t("title") }} />;
  const { items: shown, working } = log;
  // The command running now, when there is one, for the working line.
  const running = shown.flatMap((item) => (item.kind === "tools" ? item.calls : [])).findLast((call: ToolCall) => call.state === "running" && call.tool === "bash" && call.target);
  const latest = latestOf(events);
  const taskStatus = statusOf(latest, status.online);
  const machineName = machine?.name ?? "";
  const openAgent = () => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } });

  const renderItem = ({ item }: { item: Item }) =>
    item.kind === "member" ? (
      <Bubble text={item.text} />
    ) : item.kind === "agent" ? (
      <AgentText text={item.text} />
    ) : item.kind === "tools" ? (
      <ToolCalls calls={item.calls} />
    ) : item.kind === "changes" ? (
      <ChangesRow files={item.files} />
    ) : item.kind === "approval" ? (
      <ApprovalCard
        approval={item.approval}
        agentName={agent.name}
        look={lookOfJson(agent.character)}
        allowlist={allowlistOf(agent) ?? []}
        // v0.1 Members in trust are all Owners, who may Approve and Manage every Agent; v0.3 reads Grants.
        canAnswer={!readOnly}
        canManage={!readOnly}
        online={status.online !== false && !!link}
        now={now}
        // Answering takes a fresh unlock in v0.3 (ADR 0012); the Controller already asks for it when it unlocks.
        onAnswer={({ decision, allowAlways }) => (link && machine ? link.answerApproval(machine, { agent: agent.id, task, request: item.approval.request, decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }) }) : null)}
        onSteer={() => input.current?.focus()}
      />
    ) : item.kind === "stopped" ? (
      <StoppedLine member={item.member} at={item.at} now={now} />
    ) : item.kind === "compacted" ? (
      <CompactedCard item={item} />
    ) : item.kind === "file" ? (
      <FileCard item={item} onOpen={() => (link && machine ? link.openFile(machine, task, agent.id, item.path, item.hash, item.name) : Promise.reject(new Error("hub.machine_offline")))} />
    ) : item.kind === "interrupted" ? (
      <InterruptedCard machine={machineName} agentName={agent.name} readOnly={readOnly} onContinue={() => void composer.send(t("interrupted.continueMessage"))} />
    ) : item.kind === "time" ? (
      <Separator at={item.at} now={now} />
    ) : item.code === "budget.exhausted" ? (
      <BudgetCard machine={machineName} agent={agent} readOnly={readOnly} />
    ) : (
      <FailedCard code={item.code} agentName={agent.name} />
    );

  const tail = pending.length > 0 || working;
  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={-insets.bottom} style={{ flex: 1 }}>
      {/* The Agent's name with what it is doing under it, so the state stays in view however far the log scrolls. */}
      <Stack.Screen
        options={{
          title: agent.name,
          headerTitle: () => <TaskTitle readOnly={readOnly} agent={agent} machineName={machineName} status={taskStatus} latest={latest} events={events} online={status.online} />,
        }}
      />
      {/* Other Tasks, a new Task and the settings all live on the Agent's page. */}
      {!readOnly && <HeaderAction label={t("agent")} icon="sliders" onPress={openAgent} />}
      <FlatList
        ref={scroll}
        data={shown}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        // ponytail: every item renders on open, as the ScrollView did, so the first jump to the end lands on the real end;
        // windowing still trims what scrolls far away. An inverted list would drop this, at the cost of the follow rule below.
        initialNumToRender={shown.length}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.height;
        }}
        // Only when there is more than fits: on iOS, scrolling a short page to its end slides it under the header.
        // And only while the reader is at the end, so new content never pulls them away from what they scrolled up to read.
        onContentSizeChange={(_, height) => {
          if (height > viewport.current && atEnd.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          if (dragging.current) atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < FOLLOW_END_PT;
        }}
        onMomentumScrollEnd={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          dragging.current = false;
          atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < FOLLOW_END_PT;
        }}
        onScrollEndDrag={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          dragging.current = false;
          atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < FOLLOW_END_PT;
        }}
        // A flick keeps moving after the finger lifts; that glide is still the reader's.
        onMomentumScrollBegin={() => {
          dragging.current = true;
        }}
        scrollEventThrottle={16}
        // The end of the log rests clear of the fade.
        contentContainerStyle={[column, { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: FADE, gap: space.inset }]}
        ListEmptyComponent={
          pending.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.inset, paddingHorizontal: 22 }}>
              <Character look={lookOfJson(agent.character)} mood={moodOf([], status.online)} size={160} />
              <Text variant="title" style={{ textAlign: "center" }}>
                {t("emptyTitle", { name: agent.name })}
              </Text>
              <Text variant="callout" tone="secondary" style={{ textAlign: "center" }}>
                {t("empty", { name: agent.name })}
              </Text>
            </View>
          ) : undefined
        }
        // Messages still on their way, then what the Agent is doing now, after the log.
        ListFooterComponent={
          tail ? (
            <>
              {pending.map((p, index) => (
                <PendingBubble key={p.id} message={p} position={index + 1} busy={composer.busy} />
              ))}
              {working &&
                (running ? (
                  // The board's grey pill naming the command under way.
                  <Card style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.sm, height: 32, paddingVertical: 0, paddingHorizontal: space.md, borderRadius: radius.md }}>
                    <Spinner />
                    <Text variant="caption" tone="body" mono numberOfLines={1} style={{ flexShrink: 1 }}>
                      {t("runningCommand", { target: running.target })}
                    </Text>
                  </Card>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    <Spinner />
                    <Text variant="footnote" tone="secondary">
                      {t("working")}
                    </Text>
                  </View>
                ))}
            </>
          ) : undefined
        }
        ListFooterComponentStyle={{ gap: space.inset }}
      />
      <Fade />
      <Composer composer={composer} agentName={agent.name} readOnly={readOnly} online={status.online} canSend={!!link && !!machine} contextUsage={contextUsageOf(events)} stopError={status.stopError} inputRef={input} />
    </KeyboardAvoidingView>
  );
}
