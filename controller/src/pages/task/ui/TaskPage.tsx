import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { dismissPendingMessage, TaskStatusLabel, usePendingMessages, useTaskEvents } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, column, HeaderAction, Label, radius, space, Text, type, useColors } from "../../../shared/ui";
import { items } from "../model/items";
import { AgentText } from "./AgentText";

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

// Laid out like Messages: your messages in accent bubbles on the right. The
// Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const t = useT("task");
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
  const scroll = useRef<ScrollViewInstance>(null);
  const viewport = useRef(0);

  if (!agent || !machine || !events || !pending) return <Stack.Screen options={{ title: t("title") }} />;
  const { items: shown, working } = items(events);
  const message = text.trim();

  function send() {
    if (!message || !link || !machine || !agent) return;
    setText("");
    void link.sendMessage(machine, { agent: agent.id, task, text: message });
  }

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      {/* The Agent's name with what it is doing under it, so the state stays in view however far the log scrolls. */}
      <Stack.Screen
        options={{
          title: agent.name,
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Text variant="headline" numberOfLines={1}>
                {agent.name}
              </Text>
              {(events.length > 0 || status.online === false) && <TaskStatusLabel status={status.online === false ? "offline" : working ? "working" : "done"} variant="caption" />}
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
        contentContainerStyle={[column, { padding: space.lg, gap: space.lg }]}
      >
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
      <View style={[column, { paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg }]}>
        {/* Like the AI apps on iOS: the field on top and, inside the same box, the main action (controller-prototype's Composer). */}
        <Card raised style={{ gap: space.xs, padding: space.sm }}>
          <TextInput
            aria-label={t("placeholder", { name: agent.name })}
            placeholder={status.online === false ? t("offline") : t("placeholder", { name: agent.name })}
            placeholderTextColor={colors.tertiaryLabel}
            value={text}
            onChangeText={setText}
            multiline
            style={[type.body, { minHeight: 40, maxHeight: 140, paddingHorizontal: space.sm, paddingVertical: space.sm, color: colors.label }]}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button label={t("send")} icon="send" variant="primary" disabled={!message || !link} onPress={send} />
          </View>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}
