import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { dismissPendingMessage, usePendingMessages, useTaskEvents } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, column, HeaderAction, Icon, radius, space, Text, useColors } from "../../../shared/ui";
import { items } from "../model/items";

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
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <Icon name="warning" color="orange" />
      <Text selectable variant="footnote" tone="secondary" style={{ flexShrink: 1 }}>
        {describeError({ code })}
      </Text>
    </View>
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
      <Stack.Screen options={{ title: agent.name }} />
      <HeaderAction label={t("agent")} icon="agent" onPress={() => router.push({ pathname: "/agent/[agent]", params: { agent: agent.id } })} />
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
            <Text key={item.key} selectable>
              {item.text}
            </Text>
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
                <Text variant="caption" tone="secondary">
                  {t("sending")}
                </Text>
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
      <View style={[column, { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }]}>
        {status.online === false && (
          <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "center" }}>
            <Icon name="offline" />
            <Text variant="footnote" tone="secondary">
              {t("offline")}
            </Text>
          </View>
        )}
        {/* Like the AI apps on iOS: the field and the send button share one raised box. */}
        <Card raised style={{ flexDirection: "row", alignItems: "flex-end", padding: space.sm, paddingLeft: space.lg, borderRadius: radius.card }}>
          <TextInput
            aria-label={t("placeholder", { name: agent.name })}
            placeholder={t("placeholder", { name: agent.name })}
            placeholderTextColor={colors.tertiaryLabel}
            value={text}
            onChangeText={setText}
            multiline
            style={{ flex: 1, minHeight: 36, maxHeight: 160, paddingVertical: space.sm, fontSize: 17, color: colors.label }}
          />
          <Button label={t("send")} icon="send" variant="primary" disabled={!message || !link} onPress={send} />
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}
