import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlatList, KeyboardAvoidingView, View, type TextInputInstance } from "react-native";
import { allowlistOf } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { latestOf, markRead, statusOf, titleOfEvents, usePendingMessages, useTaskEvents, useTaskRow } from "../../../entities/task";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { formatList, useNow } from "../../../shared/lib";
import { Bubble, Card, column, Fade, FADE, HeaderAction, radius, space, Spinner, Text, TopFade, useSplit } from "../../../shared/ui";
import { contextUsageOf, items, type Item, type ToolCall } from "../model/items";
import { useTaskScreen } from "../model/use-task-screen";
import { scopeNeeds, useScheduleScope } from "../model/use-schedule-scope";
import { useComposer } from "../model/use-composer";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { QuestionCard } from "./QuestionCard";
import { Composer } from "./Composer";
import { BudgetCard, CompactedCard, FailedCard, FileCard, InterruptedCard, RoundLine, Separator, SkippedCard, StoppedLine } from "./LogCards";
import { PendingBubble } from "./PendingBubble";
import { TaskTitle } from "./TaskTitle";
import { ChangesRow, ToolCalls } from "./ToolCalls";

/** How close to the end of the log, in points, still counts as reading the end. */
const FOLLOW_END_PT = 80;
/** How many of the newest log items draw at first; scrolling up to the top draws this many more each time. */
const PAGE = 200;

// Laid out like Messages: your messages in accent bubbles on the right. The
// Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const t = useT("task");
  const language = useLanguage();
  const { task, agent: agentId } = useLocalSearchParams<{ task: string; agent: string }>();
  const screen = useTaskScreen(task, agentId);
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const pending = usePendingMessages(task);
  const now = useNow();
  const split = useSplit();
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<FlatList<Item>>(null);
  // Whether the reader is at the end of the log, so new content follows only then. Only the reader's own
  // scrolling changes it: a scroll the page makes (to the end, mid-animation, while a card grows below)
  // must never read as "they scrolled up", or what arrives next is left off screen.
  const atEnd = useRef(true);
  // ponytail: only the newest items draw, so a long Task opens fast; items() still reads every event (~20ms at 8,000 on a Mac),
  // load events by page too if Tasks grow past that.
  const [drawn, setDrawn] = useState(PAGE);
  const dragging = useRef(false);
  // The scroll view's own end, not FlatList's: FlatList adds up the cells it has measured (a guess for one not laid out
  // yet, such as an Approval card that just came) and leaves out the padding and the header's inset, so it stops short.
  const toEnd = (animated: boolean) => scroll.current?.getNativeScrollRef()?.scrollToEnd({ animated });
  // Whoever sends wants to see the message land, even after scrolling up to read: follow the end again.
  const followEnd = () => {
    atEnd.current = true;
    toEnd(true);
  };
  // The log only changes with its events; the clock matters only while an Approval is open and can still time out.
  const settled = useMemo(() => (events ? items(events, Date.now()) : null), [events]);
  const ticking = !!settled?.items.some((item) => (item.kind === "approval" && item.approval.status === "open") || (item.kind === "question" && item.question.status === "open"));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ticking && now` makes the clock a dependency only while it can change the log
  const log = useMemo(() => (events && ticking ? items(events, now) : settled), [events, ticking, ticking && now, settled]);
  // A quiet Schedule round this device let the log of go (pruneQuietRounds): it had events, and has none here now.
  const row = useTaskRow(task)?.[0];
  const pruned = events?.length === 0 && (row?.synced_seq ?? 0) > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (pruned && link && screen?.machine) link.refetchTask(screen.machine, { agent: agentId, task });
  }, [pruned, link, screen?.machine?.id, agentId, task]);
  // What is on screen is read: the Inbox stops listing this Task as unread, and an answer that comes while it is open is read too.
  const database = useDatabase();
  const newest = events?.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (newest > 0) void markRead(database, task, newest);
  }, [database, task, newest]);
  const composer = useComposer({ task, screen, link, events: events ?? undefined, log: log?.items, onSend: followEnd });
  const schedule = useScheduleScope(events, screen?.machine, agentId, screen?.status.online ?? null);

  // A Machine no longer paired (or a deleted Agent's unknown one) still shows the log, read from the device.
  if (!screen || !events || !pending || !log) return <Stack.Screen options={{ title: t("title") }} />;
  const { agent, machine, readOnly, status } = screen;
  const { items: all, working } = log;
  const shown = all.length > drawn ? all.slice(-drawn) : all;
  // The command running now, when there is one, for the working line.
  const running = shown.flatMap((item) => (item.kind === "tools" ? item.calls : [])).findLast((call: ToolCall) => call.state === "running" && call.tool === "bash" && call.target);
  const latest = latestOf(events);
  const taskStatus = statusOf(latest, status.online);
  const machineName = machine?.name ?? "";
  const openAgent = () => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } });
  const allowlist = allowlistOf(agent) ?? [];
  const canSign = !readOnly && status.online !== false && !!link && !schedule.sending;
  const scopeFor = (command: string) => (schedule.trigger ? scopeNeeds(command, allowlist, schedule.trigger) : null);

  const renderItem = ({ item }: { item: Item }) =>
    item.kind === "round" ? (
      <RoundLine item={item} />
    ) : item.kind === "member" ? (
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
        allowlist={allowlist}
        // Approve answers it; Manage may also allow it always (ADR 0010). Use only sees it wait.
        canAnswer={!readOnly && agent.level !== "use"}
        canManage={!readOnly && agent.level === "manage"}
        online={status.online !== false && !!link}
        now={now}
        me={machine?.member_id}
        // Answering takes a fresh unlock in v0.3 (ADR 0012); the Controller already asks for it when it unlocks.
        onAnswer={({ decision, allowAlways, subdomains }) =>
          link && machine ? link.answerApproval(machine, { agent: agent.id, task, request: item.approval.request, decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }), ...(subdomains === true && { subdomains }) }) : null
        }
        onSteer={() => {
          composer.steer(item.approval.request);
          input.current?.focus();
        }}
        scope={item.approval.kind !== "domain" && schedule.trigger && !schedule.sending ? { entries: scopeFor(item.approval.command) ?? [], add: schedule.add } : undefined}
      />
    ) : item.kind === "question" ? (
      <QuestionCard
        question={item.question}
        look={lookOfJson(agent.character)}
        me={machine?.member_id}
        online={status.online !== false && !!link && !readOnly}
        onAnswer={(answer) => (link && machine ? link.answerCard(machine, { agent: agent.id, task, id: item.question.id, answer }) : null)}
      />
    ) : item.kind === "skipped" ? (
      <SkippedCard
        item={item}
        entries={item.domain ? null : scopeFor(item.target)}
        canScope={canSign}
        onScope={async () => {
          const entries = scopeFor(item.target) ?? [];
          return (await keySession.signed(t("authenticate.scope", { entries: formatList(entries, language) }), () => schedule.add(entries))).status === "sent";
        }}
      />
    ) : item.kind === "stopped" ? (
      <StoppedLine member={item.member} me={machine?.member_id} at={item.at} now={now} />
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
      <FailedCard code={item.code} retryAt={item.retryAt} agentName={agent.name} />
    );

  const tail = pending.length > 0 || working;
  const title = <TaskTitle readOnly={readOnly} agent={agent} status={taskStatus} latest={latest} events={events} online={status.online} title={titleOfEvents(events)} task={task} />;
  // iOS 26 would wrap a custom left item in a glass capsule of its own; the head and name sit on the bar instead.
  const leftTitle = process.env.EXPO_OS === "ios" ? { unstable_headerLeftItems: () => [{ type: "custom" as const, element: title, hidesSharedBackground: true }] } : { headerLeft: () => title };
  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={-insets.bottom} style={{ flex: 1 }}>
      {/* The Character doing what this Task does, beside the back button, with the Agent's name and what the Task is
          about, so both stay in view however far the log scrolls. A deleted Agent keeps a centred title. iOS 26's soft
          edge is too short for this tall bar and left the log readable through the title: TopFade replaces it. */}
      <Stack.Screen options={{ scrollEdgeEffects: { top: "hidden" }, ...(readOnly ? { title: agent.name, headerTitle: () => title } : { title: "", headerBackVisible: !split, ...leftTitle }) }} />
      {/* Other Tasks, a new Task and the settings all live on the Agent's page. */}
      {!readOnly && <HeaderAction label={t("agent")} icon="sliders" onPress={openAgent} />}
      <FlatList
        ref={scroll}
        data={shown}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        // Every drawn item renders on open, so the first jump to the end lands on the real end; there are at most `drawn`.
        initialNumToRender={shown.length}
        // Older items join above as the reader reaches the top, and what they were reading stays where it was.
        // Only when the reader scrolled there: the list opens at its top before the jump to the end, which would load all.
        onStartReached={() => {
          if (dragging.current && all.length > drawn) setDrawn(drawn + PAGE);
        }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        // A short log too: iOS insets the content by the header, so its bottom rests that far under the composer until
        // it is scrolled to the end. Not the empty page, whose centred Character would slide under the header.
        // And only while the reader is at the end, so new content never pulls them away from what they scrolled up to read.
        onContentSizeChange={() => {
          if (atEnd.current && (shown.length > 0 || pending.length > 0)) toEnd(false);
        }}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          if (dragging.current) atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < FOLLOW_END_PT;
        }}
        // iOS also fires this when the page's own animated scroll ends, with no momentum begun: that is not the reader's.
        onMomentumScrollEnd={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          if (!dragging.current) return;
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
      {process.env.EXPO_OS === "ios" && <TopFade height={headerHeight} />}
      <Fade />
      <Composer composer={composer} agentName={agent.name} readOnly={readOnly} online={status.online} canSend={!!link && !!machine} contextUsage={contextUsageOf(events)} stopError={status.stopError} inputRef={input} />
    </KeyboardAvoidingView>
  );
}
