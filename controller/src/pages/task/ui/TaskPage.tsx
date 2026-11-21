import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, View, type ScrollViewInstance, type TextInputInstance } from "react-native";
import { allowlistOf, useAgents, useTrashedAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { dismissPendingMessage, isBudgetOut, latestOf, statusOf, TaskStatusLabel, usePendingMessages, useTaskEvents, useTaskRow } from "../../../entities/task";
import { MAX_ATTACHMENT_BYTES, useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { formatTokens, useNow, when } from "../../../shared/lib";
import { Bubble, Button, Card, Chip, column, confirm, Fade, FADE, HeaderAction, Icon, Input, Inset, Label, Meter, radius, space, Spinner, Text } from "../../../shared/ui";
import { contextUsageOf, items, type Item, type ToolCall } from "../model/items";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { ContextMeter } from "./ContextMeter";
import { ChangesRow, ToolCalls } from "./ToolCalls";

/** How close to the end of the log, in points, still counts as reading the end. */
const FOLLOW_END_PT = 80;

function FailedCard({ code, agentName }: { code: string; agentName: string }) {
  const t = useT("task");
  return (
    <Card tone="danger" style={{ padding: space.inset, gap: space.smd }}>
      <Label icon="failed" iconColor="red" variant="subheadline" tone="label" strong>
        <Text variant="callout" tone="danger" strong>{t("failedTitle")}</Text>
      </Label>
      <Text variant="callout" tone="body">
        {describeError({ code })} {t("failedBody", { name: agentName })}
      </Text>
    </Card>
  );
}

function Problem({ code }: { code: string }) {
  return (
    <Label icon="warning" iconColor="orange">
      {describeError({ code })}
    </Label>
  );
}

function CompactedCard({ item }: { item: Extract<Item, { kind: "compacted" }> }) {
  const t = useT("task");
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
      <Card style={{ padding: space.inset, gap: space.smd }}>
        <Label icon="info" tone="label" strong variant="subheadline">{t("compacted.title")} · {when(item.at, language)}</Label>
        <Text variant="callout" tone="body" numberOfLines={open ? undefined : 2} selectable>
          {item.summary}
        </Text>
        <Text variant="caption" strong style={{ textDecorationLine: "underline" }}>
          {open ? t("compacted.hide") : t("compacted.show")}
        </Text>
      </Card>
    </Pressable>
  );
}

function ContextDetails({ usage }: { usage: NonNullable<ReturnType<typeof contextUsageOf>> }) {
  const t = useT("task");
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text>{t("context.used")}</Text>
        <Text tone="secondary" style={{ flexShrink: 1, textAlign: "right" }}>{t("context.of", { used: usage.tokens.toLocaleString(), window: usage.window.toLocaleString() })}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text>{t("context.compactAt")}</Text>
        <Text tone="secondary">{t("context.threshold", { tokens: usage.threshold.toLocaleString() })}</Text>
      </View>
    </View>
  );
}

function FileCard({ item, onOpen }: { item: Extract<Item, { kind: "file" }>; onOpen: () => Promise<void> }) {
  const t = useT("task");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await onOpen();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "attachment.invalid");
    } finally {
      setOpening(false);
    }
  }
  return (
    <Card style={{ paddingVertical: 10, paddingRight: 10, paddingLeft: space.inset, gap: space.sm }}>
      <View aria-label={t("file.offered")} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Inset chip>
          <Icon name="file" size="md" color="link" />
        </Inset>
        <View style={{ flex: 1 }}>
          <Text variant="callout" strong numberOfLines={1}>{item.name}</Text>
          <Text variant="caption" tone="secondary">{t("file.size", { size: Math.max(1, Math.round(item.size / 1024)) })}</Text>
        </View>
        <Button label={opening ? t("file.opening") : t("file.open")} variant="primary" disabled={opening} onPress={() => void open()} />
      </View>
      {error && <Problem code={error} />}
    </Card>
  );
}

// The one failure with a way out: the Turn stopped because today's token Budget ran out (`daily-budget`).
function BudgetCard({ machine, agent, readOnly }: { machine: string; agent: AgentRow; readOnly: boolean }) {
  const t = useT("task");
  const used = agent.usage_tokens ?? 0;
  return (
    <Card tone="warning" style={{ padding: space.inset }}>
      <Label icon="info" iconColor="orange" tone="label" strong variant="subheadline">
        {t("budget.out")}
      </Label>
      <Text variant="callout" tone="body">{t("budget.body", { machine })}</Text>
      {/* How much of today's Budget went, from the Agent's usage; a deleted Agent's placeholder has none. */}
      {!!agent.budget && (
        <>
          <Meter thin value={used / agent.budget} label={t("budget.out")} />
          <Text variant="caption" tone="secondary">
            {t("budget.used", { used: formatTokens(used), budget: formatTokens(agent.budget) })}
          </Text>
        </>
      )}
      {/* A deleted Agent has no settings page, so the way to add Budget goes with it. */}
      {!readOnly && (
        <View style={{ flexDirection: "row" }}>
          <Button label={t("budget.add")} variant="primary" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />
        </View>
      )}
    </Card>
  );
}

// The Turn a restart cut off: the files are still there, and nothing runs again on its own (ADR 0033).
function InterruptedCard({ machine, agentName, onContinue, readOnly }: { machine: string; agentName: string; onContinue: () => void; readOnly: boolean }) {
  const t = useT("task");
  return (
    <Card style={{ padding: space.inset }}>
      <Label icon="offline" iconColor="label" tone="label" strong variant="subheadline">{t("interrupted.title", { machine })}</Label>
      <Text variant="callout" tone="body">{t("interrupted.body", { name: agentName })}</Text>
      {/* Carry on sends a message, which a deleted Agent can no longer take. */}
      {!readOnly && (
        <View style={{ flexDirection: "row" }}>
          <Button label={t("interrupted.continue")} variant="primary" onPress={onContinue} />
        </View>
      )}
    </Card>
  );
}

// The boards' centred time line between groups far apart: today and yesterday by name, else the date.
function Separator({ at, now }: { at: number; now: number }) {
  const t = useT("task");
  const language = useLanguage();
  const date = new Date(at);
  const time = date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  const words = days === 0 ? t("separator.today", { time }) : days === 1 ? t("separator.yesterday", { time }) : t("separator.date", { date: date.toLocaleDateString(language, { day: "numeric", month: "short" }), time });
  return (
    <Text variant="caption" tone="secondary" style={{ alignSelf: "center" }}>
      {words}
    </Text>
  );
}

// A deleted Agent's Task still opens: the row keeps the Machine, so the log fills in from the Agent's event history.
function placeholderAgent(id: string, machineId: string | undefined, name: string): AgentRow {
  return {
    id,
    machine_id: machineId ?? "",
    name,
    provider: "",
    model: "",
    character: null,
    budget: null,
    usage_day: null,
    usage_tokens: null,
    allowlist: null,
    approval_timeout_s: null,
    egress: "[]",
    git_repos: null,
  };
}

// Laid out like Messages: your messages in accent bubbles on the right. The
// Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const insets = useSafeAreaInsets();
  const t = useT("task");
  const language = useLanguage();
  const database = useDatabase();
  const { task, agent: agentId } = useLocalSearchParams<{ task: string; agent: string }>();
  const agents = useAgents();
  const trashedAgents = useTrashedAgents();
  const found = agents?.find((a) => a.id === agentId);
  // A deleted Agent still names its Tasks while it waits in the trash (`agent-trash`).
  const gone = trashedAgents?.find((a) => a.id === agentId);
  // Sending, Stop and settings need the Agent itself; the history does not.
  const row = useTaskRow(task)?.[0];
  const agent = found ?? placeholderAgent(agentId, gone?.machine_id ?? row?.machine_id, gone?.name ?? t("deletedAgent"));
  const machines = useMachines();
  const machine = machines?.find((m) => m.id === agent.machine_id);
  const readOnly = !found;
  const status = useMachineStatus(machine?.id ?? "");
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const pending = usePendingMessages(task);
  const [text, setText] = useState("");
  // Set when the Stop went out, so the brake can say it is working on it until the Turn ends.
  const [stopAsked, setStopAsked] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; uri: string }[]>([]);
  const [sendProblem, setSendProblem] = useState<string | null>(null);
  const now = useNow();
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const viewport = useRef(0);
  // Whether the reader is at the end of the log, so new content follows only then.
  const atEnd = useRef(true);
  // Set before the first await, so a second tap while files upload cannot send twice.
  const [sending, setSending] = useState(false);

  // Until both lists land, neither "an Agent" nor "a deleted Agent" is known yet:
  // showing the deleted state here would flash a wrong name and no composer.
  // A Machine no longer paired (or a deleted Agent's unknown one) still shows the log, read from the device.
  if (!agents || !trashedAgents || !machines || !events || !pending) return <Stack.Screen options={{ title: t("title") }} />;
  const { items: shown, working } = items(events, now);
  const message = text.trim();
  // The command running now, when there is one, for the working line.
  const running = shown.flatMap((item) => (item.kind === "tools" ? item.calls : [])).findLast((call: ToolCall) => call.state === "running" && call.tool === "bash" && call.target);
  const latest = latestOf(events);
  const taskStatus = statusOf(latest, status.online);
  const contextUsage = events ? contextUsageOf(events) : null;
  // A Turn is running: the Machine queues a new message until it ends.
  const busy = statusOf(latest, true) === "working";
  // The Turn ended (by the Stop or by itself) or the Machine refused: nothing is stopping any more.
  if (stopAsked && (!busy || status.stopError)) setStopAsked(false);
  const isStopping = stopAsked && busy && !status.stopError;

  async function send(text = message) {
    if ((!text && attachments.length === 0) || !link || !machine || readOnly || sending) return;
    const files = attachments;
    const words = text;
    Keyboard.dismiss();
    setSendProblem(null);
    setSending(true);
    const sent = [];
    try {
      for (const file of files) {
        const attachment = await link.sendAttachment(machine, task, file);
        if (!attachment) throw new Error("hub.machine_offline");
        sent.push(attachment);
      }
    } catch (problem) {
      setSendProblem(problem instanceof Error ? problem.message : "attachment.invalid");
      setSending(false);
      return;
    }
    setText("");
    setAttachments([]);
    try {
      await link.sendMessage(machine, { agent: agent.id, task, text: words || t("attachedOnly"), attachments: sent });
    } catch (problem) {
      setSendProblem(problem instanceof Error ? problem.message : "hub.machine_offline");
    } finally {
      setSending(false);
    }
  }

  async function attach() {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    const asset = result.assets?.[0];
    if (!asset) return;
    if (asset.size && asset.size > MAX_ATTACHMENT_BYTES) {
      setSendProblem("attachment.too_large");
      return;
    }
    setSendProblem(null);
    setAttachments((current) => [...current, { name: asset.name, uri: asset.uri }]);
  }

  // Stop can cut work off halfway, so it asks first and says what stops (ADR 0017).
  async function stop() {
    if (!link || !machine || readOnly) return;
    const ok = await confirm({ title: t("stop.title"), message: t("stop.message", { agent: agent.name }), action: t("stop.action"), cancel: t("stop.cancel"), destructive: true });
    if (!ok) return;
    Keyboard.dismiss();
    if (link.stopTurn(machine, { agent: agent.id, task, id: randomUUID() })) setStopAsked(true);
  }

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={-insets.bottom} style={{ flex: 1 }}>
      {/* The Agent's name with what it is doing under it, so the state stays in view however far the log scrolls. */}
      <Stack.Screen
        options={{
          title: agent.name,
          // The Character left of the name, doing what this Task is doing, and the status under the name;
          // a tap opens the Agent's page, as the settings button does. A deleted Agent has no page.
          // The boards' title for each state: a deleted Agent's grey name and trash, a new Task's own title, and
          // otherwise the Character left of the name doing what this Task does. Waiting drops the head, since the
          // Approval card under it already carries one. A tap opens the Agent's page, as the settings button does.
          headerTitle: () =>
            readOnly ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Icon name="trash" size="md" color="tertiaryLabel" />
                <View>
                  <Text variant="headline" tone="secondary" numberOfLines={1}>
                    {t("deletedAgent")}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {t("deletedSubtitle")}
                  </Text>
                </View>
              </View>
            ) : (
              <Pressable role="button" aria-label={t("openAgent", { name: agent.name })} onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {taskStatus !== "new" && taskStatus !== "waiting" && <Character look={lookOfJson(agent.character)} mood={moodOf(events, status.online)} size={52} />}
                <View style={{ alignItems: taskStatus === "new" || taskStatus === "waiting" ? "center" : "flex-start" }}>
                  <Text variant="headline" numberOfLines={1}>
                    {taskStatus === "new" ? t("newTitle") : agent.name}
                  </Text>
                  {taskStatus === "new" ? (
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {t("newSubtitle", { name: agent.name, machine: machine?.name ?? "" })}
                    </Text>
                  ) : taskStatus === "waiting" ? (
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {t("waitingHeader")}
                    </Text>
                  ) : taskStatus === "failed" && isBudgetOut(latest) ? (
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {t("budgetHeader")}
                    </Text>
                  ) : taskStatus === "failed" ? (
                    <Text variant="caption" tone="danger" numberOfLines={1}>
                      {t("failedTitle")}
                    </Text>
                  ) : (
                    <TaskStatusLabel status={taskStatus} variant="caption" />
                  )}
                </View>
              </Pressable>
            ),
        }}
      />
      {/* Other Tasks, a new Task and the settings all live on the Agent's page. */}
      {!readOnly && <HeaderAction label={t("agent")} icon="sliders" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />}
      <ScrollView
        ref={scroll}
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
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < FOLLOW_END_PT;
        }}
        scrollEventThrottle={16}
        // The end of the log rests clear of the fade.
        contentContainerStyle={[column, { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: FADE, gap: space.inset }]}
      >
        {shown.length === 0 && pending.length === 0 && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.inset, paddingHorizontal: 22 }}>
            <Character look={lookOfJson(agent.character)} mood={moodOf([], status.online)} size={160} />
            <Text variant="title" style={{ textAlign: "center" }}>
              {t("emptyTitle", { name: agent.name })}
            </Text>
            <Text variant="callout" tone="secondary" style={{ textAlign: "center" }}>
              {t("empty", { name: agent.name })}
            </Text>
          </View>
        )}
        {shown.map((item) =>
          item.kind === "member" ? (
            <Bubble key={item.key} text={item.text} />
          ) : item.kind === "agent" ? (
            <AgentText key={item.key} text={item.text} />
          ) : item.kind === "tools" ? (
            <ToolCalls key={item.key} calls={item.calls} />
          ) : item.kind === "changes" ? (
            <ChangesRow key={item.key} files={item.files} />
          ) : item.kind === "approval" ? (
            <ApprovalCard
              key={item.key}
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
              onAnswer={({ decision, allowAlways }) =>
                link && machine ? link.answerApproval(machine, { agent: agent.id, task, request: item.approval.request, decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }) }) : null
              }
              onSteer={() => input.current?.focus()}
            />
          ) : item.kind === "stopped" ? (
            // Who braked, in the prototype's centred line, so the log says a person did this and why it ended.
            <Card key={item.key} style={{ alignSelf: "center", paddingHorizontal: space.md, paddingVertical: space.smd, borderRadius: 14 }}>
              <Label icon="stopped">{t("stopped", { member: item.member, when: when(item.at, language, now) })}</Label>
            </Card>
          ) : item.kind === "compacted" ? (
            <CompactedCard key={item.key} item={item} />
          ) : item.kind === "file" ? (
            <FileCard key={item.key} item={item} onOpen={() => (link && machine ? link.openFile(machine, task, agent.id, item.path, item.hash, item.name) : Promise.reject(new Error("hub.machine_offline")))} />
          ) : item.kind === "interrupted" ? (
            <InterruptedCard key={item.key} machine={machine?.name ?? ""} agentName={agent.name} readOnly={readOnly} onContinue={() => send(t("interrupted.continueMessage"))} />
          ) : item.kind === "time" ? (
            <Separator key={item.key} at={item.at} now={now} />
          ) : item.code === "budget.exhausted" ? (
            <BudgetCard key={item.key} machine={machine?.name ?? ""} agent={agent} readOnly={readOnly} />
          ) : (
            <FailedCard key={item.key} code={item.code} agentName={agent.name} />
          ),
        )}
        {pending.map((p, index) => (
          <Bubble
            key={p.id}
            text={p.text}
            queued
            note={
              p.error ? (
                <View style={{ alignItems: "flex-end", gap: space.xs }}>
                  <Problem code={p.error} />
                  <Pressable role="button" hitSlop={space.sm} onPress={() => void dismissPendingMessage(database, p.id)}>
                    <Text variant="footnote" strong>
                      {t("dismiss")}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                // ponytail: the board's "ลบ" on a queued message needs a way to take it back off the Machine's queue,
                // which the Protocol does not have; removing only the local copy would still send it. Add it with that message.
                <Label icon="time" variant="caption">
                  {busy ? t("queuedPosition", { position: index + 1 }) : t("sending")}
                </Label>
              )
            }
          />
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
      </ScrollView>
      <Fade />
      {/* Clear of the home indicator, as in controller-prototype's TaskPage (insets.bottom under the Composer). */}
      {readOnly ? (
        <View style={[column, { paddingHorizontal: space.xl, paddingTop: space.xs, paddingBottom: space.lg + insets.bottom }]}>
          <Card style={{ paddingHorizontal: space.lg, paddingVertical: space.inset }}>
            <Text variant="callout" tone="secondary" style={{ textAlign: "center" }}>
              {t("readOnly")}
            </Text>
          </Card>
        </View>
      ) : (
        <View style={[column, { paddingTop: space.xs, paddingHorizontal: space.md, paddingBottom: space.sm + insets.bottom }]}>
          <View style={{ position: "relative" }}>
            {contextOpen && contextUsage && (
              <View style={{ position: "absolute", bottom: "100%", left: "8%", right: "8%", paddingBottom: space.sm, zIndex: 20 }}>
                <Card raised style={{ padding: space.md, gap: space.xs }}>
                  <Label icon="info">{t("context.title")}</Label>
                  <ContextDetails usage={contextUsage} />
                </Card>
              </View>
            )}
            {attachments.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.smd, paddingBottom: space.sm }}>
                {attachments.map((file) => (
                  <Chip key={file.uri} label={file.name} aria-label={t("removeAttachment", { name: file.name })} onPress={() => setAttachments(attachments.filter((item) => item.uri !== file.uri))} />
                ))}
              </View>
            )}
            {status.online === false && (
              <Label icon="offline" style={{ alignSelf: "center", paddingBottom: space.sm }}>
                {t("offline")}
              </Label>
            )}
            {/* The boards' composer: a grey pill track with attach on the left, the field, and one round ink action. */}
            <Card style={{ flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.xs, borderRadius: 26 }}>
              <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Button label={t("attach")} icon="add" variant="ghost" size="large" disabled={status.online === false} onPress={() => void attach()} />
              </View>
              <Input
                ref={input}
                aria-label={t("placeholder", { name: agent.name })}
                placeholder={busy ? t("queued") : t("placeholder", { name: agent.name })}
                value={text}
                onChangeText={setText}
                multiline
                style={{ flex: 1, minHeight: 44, maxHeight: 140, paddingVertical: 11 }}
              />
              <ContextMeter usage={contextUsage} onPress={() => setContextOpen(!contextOpen)} />
              <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                {/* A working Agent with nothing typed offers the brake instead of send. */}
                {busy && !message ? (
                  <Button label={isStopping ? t("stop.stopping") : t("stop.button")} icon="stopped" variant="primary" size="large" disabled={status.online === false || !link || isStopping} onPress={() => void stop()} />
                ) : (
                  <Button label={t("send")} icon="send" variant="primary" size="large" disabled={(!message && attachments.length === 0) || !link || !machine || sending || status.online === false} onPress={() => void send()} />
                )}
              </View>
            </Card>
          </View>
          {status.stopError && (
            <View style={{ paddingTop: space.xs }}>
              <Problem code={status.stopError} />
            </View>
          )}
          {sendProblem && (
            <View style={{ paddingTop: space.xs }}>
              <Problem code={sendProblem} />
            </View>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
