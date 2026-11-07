import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View, type ScrollViewInstance, type TextInputInstance } from "react-native";
import { allowlistOf, useAgents } from "../../../entities/agent";import { useMachines } from "../../../entities/machine";
import { dismissPendingMessage, latestOf, statusOf, TaskStatusLabel, usePendingMessages, useTaskEvents } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Button, Card, column, confirm, HeaderAction, Label, radius, space, Text, type, useColors } from "../../../shared/ui";
import { items } from "../model/items";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { ToolCalls } from "./ToolCalls";
import { FADE, LogFade } from "./LogFade";
import { LogHead } from "./LogHead";

// The Owner's message, in an accent bubble on the right as in Messages.
function Bubble({ text, note }: { text: string; note?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", gap: space.xs }}>
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.accent }}>
        <Text selectable style={{ color: colors.onAccent }}>
          {text}
        </Text>
      </View>
      {note}
    </View>
  );
}

function Problem({ code }: { code: string }) {
  return (
    <Label icon="warning" iconColor="orange">
      {describeError({ code })}
    </Label>
  );
}

// The one failure with a way out: the Turn stopped because today's token Budget ran out (`daily-budget`).
function BudgetCard({ machine, agent }: { machine: string; agent: string }) {
  const t = useT("task");
  return (
    <Card>
      <Label icon="info" iconColor="orange">
        {t("budget.out")}
      </Label>
      <Text>{t("budget.body", { machine })}</Text>
      <View style={{ flexDirection: "row" }}>
        <Button label={t("budget.add")} variant="primary" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent } })} />
      </View>
    </Card>
  );
}

// The Turn a restart cut off: the files are still there, and nothing runs again on its own (ADR 0033).
function InterruptedCard({ machine, agentName, onContinue }: { machine: string; agentName: string; onContinue: () => void }) {
  const t = useT("task");
  return (
    <Card>
      <Label icon="offline">{t("interrupted.title", { machine })}</Label>
      <Text>{t("interrupted.body", { name: agentName })}</Text>
      <View style={{ flexDirection: "row" }}>
        <Button label={t("interrupted.continue")} variant="primary" onPress={onContinue} />
      </View>
    </Card>
  );
}

// Laid out like Messages: your messages in accent bubbles on the right. The
// Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const insets = useSafeAreaInsets();
  const t = useT("task");
  const language = useLanguage();
  const colors = useColors();
  const database = useDatabase();
  const { task, agent: agentId } = useLocalSearchParams<{ task: string; agent: string }>();
  const agent = useAgents()?.find((a) => a.id === agentId);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  const status = useMachineStatus(machine?.id ?? "");
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const pending = usePendingMessages(task);
  const [text, setText] = useState("");
  // Set when the Stop went out, so the brake can say it is working on it until the Turn ends.
  const [stopAsked, setStopAsked] = useState(false);
  const now = useNow();
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const viewport = useRef(0);

  if (!agent || !machine || !events || !pending) return <Stack.Screen options={{ title: t("title") }} />;
  const { items: shown, working } = items(events, now);
  const message = text.trim();
  const latest = latestOf(events);
  const taskStatus = statusOf(latest, status.online);
  // A Turn is running: the Machine would refuse a second message (agent.busy), so it waits here, kept in the field.
  const busy = statusOf(latest, true) === "working";
  // The Turn ended (by the Stop or by itself) or the Machine refused: nothing is stopping any more.
  if (stopAsked && (!busy || status.stopError)) setStopAsked(false);
  const isStopping = stopAsked && busy && !status.stopError;

  function send(text = message) {
    if (!text || !link || !machine || !agent || busy) return;
    Keyboard.dismiss();
    setText("");
    void link.sendMessage(machine, { agent: agent.id, task, text });
  }

  // Stop can cut work off halfway, so it asks first and says what stops (ADR 0017).
  async function stop() {
    if (!link || !machine || !agent) return;
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
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Text variant="headline" numberOfLines={1}>
                {agent.name}
              </Text>
              {/* A Task nobody has written in is not "done" yet. */}
              {taskStatus !== "new" && <TaskStatusLabel status={taskStatus} variant="caption" />}
            </View>
          ),
        }}
      />
      {/* Other Tasks, a new Task and the settings all live on the Agent's page. */}
      <HeaderAction label={t("agent")} icon="settings" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.height;
        }}
        // Only when there is more than fits: on iOS, scrolling a short page to its end slides it under the header.
        onContentSizeChange={(_, height) => {
          if (height > viewport.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        // The end of the log rests clear of the fade.
        contentContainerStyle={[column, { padding: space.lg, paddingBottom: FADE, gap: space.lg }]}
      >
        <LogHead agent={agent} machine={machine.name} events={events} online={status.online} />
        {shown.length === 0 && pending.length === 0 && (
          <Text variant="subheadline" tone="secondary" style={{ textAlign: "center", marginTop: space.xl }}>
            {t("empty", { name: agent.name })}
          </Text>
        )}
        {shown.map((item) =>
          item.kind === "member" ? (
            <Bubble key={item.key} text={item.text} />
          ) : item.kind === "agent" ? (
            <AgentText key={item.key} text={item.text} />
          ) : item.kind === "tools" ? (
            <ToolCalls key={item.key} calls={item.calls} />
          ) : item.kind === "approval" ? (
            <ApprovalCard
              key={item.key}
              approval={item.approval}
              agentName={agent.name}
              allowlist={allowlistOf(agent) ?? []}
              // v0.1 Members in trust are all Owners, who may Approve and Manage every Agent; v0.3 reads Grants.
              canAnswer
              canManage
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
            <Label key={item.key} icon="stopped" style={{ alignSelf: "center" }}>
              {t("stopped", { member: item.member, when: when(item.at, language, now) })}
            </Label>
          ) : item.kind === "interrupted" ? (
            <InterruptedCard key={item.key} machine={machine.name} agentName={agent.name} onContinue={() => send(t("interrupted.continueMessage"))} />
          ) : item.code === "budget.exhausted" ? (
            <BudgetCard key={item.key} machine={machine.name} agent={agent.id} />
          ) : (
            <Problem key={item.key} code={item.code} />
          ),
        )}
        {pending.map((p) => (
          <Bubble
            key={p.id}
            text={p.text}
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
                <Label icon="time" variant="caption">
                  {t("sending")}
                </Label>
              )
            }
          />
        ))}
        {working && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <ActivityIndicator size="small" color={colors.secondaryLabel} />
            <Text variant="footnote" tone="secondary">
              {t("working")}
            </Text>
          </View>
        )}
      </ScrollView>
      <LogFade />
      {/* Clear of the home indicator, as in controller-prototype's TaskPage (insets.bottom under the Composer). */}
      <View style={[column, { paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm + insets.bottom }]}>
        {/* Like the AI apps on iOS: the field on top and, inside the same box, the main action (controller-prototype's Composer). */}
        <Card raised style={{ gap: space.xs, padding: space.sm }}>
          <TextInput
            ref={input}
            aria-label={t("placeholder", { name: agent.name })}
            placeholder={status.online === false ? t("offline") : busy ? t("busy") : t("placeholder", { name: agent.name })}
            placeholderTextColor={colors.tertiaryLabel}
            value={text}
            onChangeText={setText}
            multiline
            style={[type.body, { minHeight: 40, maxHeight: 140, paddingHorizontal: space.sm, paddingVertical: space.sm, color: colors.label }]}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            {/* A working Agent with nothing typed offers the brake instead of send (controller-prototype's Composer). */}
            {busy && !message ? (
              <Button
                label={isStopping ? t("stop.stopping") : t("stop.button")}
                icon="stopped"
                variant="primary"
                disabled={status.online === false || !link || isStopping}
                onPress={() => void stop()}
              />
            ) : (
              <Button label={t("send")} icon="send" variant="primary" disabled={!message || !link || busy} onPress={() => send()} />
            )}
          </View>
        </Card>
        {status.stopError && (
          <View style={{ paddingTop: space.xs }}>
            <Problem code={status.stopError} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
