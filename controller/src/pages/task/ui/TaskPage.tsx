import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, View, type ScrollViewInstance, type TextInputInstance, type ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Character, useAgent } from "../../../entities/agent";
import { approvals, queued, statusOf, TaskStatus, toolResults, turnOpen, useTask, type TaskEvent } from "../../../entities/task";
import { ago, useNow } from "../../../shared/lib";
import { column, Label, radius, space, Text, useColors } from "../../../shared/ui";
import { items } from "../model/items";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { Composer } from "./Composer";
import { ToolCalls } from "./ToolCalls";

// The Member's message, in an accent bubble on the right as in Messages.
function Bubble({ text, queued: waiting, agent }: { text: string; queued: boolean; agent: string }) {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", gap: space.xs }}>
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.accent }}>
        <Text selectable style={{ color: colors.onAccent }}>
          {text}
        </Text>
      </View>
      {waiting && (
        <Label icon="time" variant="caption">
          รอคิว · {agent} จะอ่านเมื่อ Turn นี้จบ
        </Label>
      )}
    </View>
  );
}

// Laid out like Messages: the Agent at the top, your messages in accent bubbles
// on the right. The Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const { task: id } = useLocalSearchParams<{ task: string }>();
  const task = useTask(id);
  const agent = useAgent(task?.agent);
  const now = useNow();
  const insets = useSafeAreaInsets();
  const frame = useRef<ViewInstance>(null);
  const [top, setTop] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const size = useRef({ content: 0, view: 0 });
  const headerHeight = useHeaderHeight();
  const input = useRef<TextInputInstance>(null);

  if (!task || !agent) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Task" }} />
        <Text tone="secondary">ไม่พบ Task นี้</Text>
      </View>
    );
  }

  const { id: taskId } = task;
  const { name: agentName } = agent;
  const status = statusOf(task.events, agent.machine.online, now);
  const waitingMessages = queued(task.events);
  const approvalStatus = approvals(task.events, now);
  const results = toolResults(task.events);

  // scrollToEnd clamps at 0, but under iOS 26's glass header the list rests above 0 by
  // the header's height, so a short Task would slide its first lines under the header.
  // Scroll only as far as the end needs, and not at all when everything fits.
  function toEnd(animated: boolean) {
    const { content, view } = size.current;
    const y = content - view;
    if (view && y > top - headerHeight) scroll.current?.scrollTo({ y, animated });
  }

  function render(event: TaskEvent) {
    switch (event.type) {
      case "message":
        return <Bubble key={event.seq} text={event.text} queued={waitingMessages.has(event.seq)} agent={agentName} />;
      case "text":
        return <AgentText key={event.seq} text={event.text} />;
      case "approval_request":
        return (
          <ApprovalCard
            key={event.seq}
            taskId={taskId}
            agent={agentName}
            request={event}
            status={approvalStatus.get(event.id) ?? "open"}
            now={now}
            onSteer={() => input.current?.focus()}
          />
        );
      case "stop":
        return (
          <Label key={event.seq} icon="stopped" style={{ alignSelf: "center" }}>
            คุณหยุด Turn นี้ · {ago(event.at, now)}
          </Label>
        );
      default:
        return null;
    }
  }

  return (
    // The keyboard offset is where this screen starts in the window, measured: 0 under
    // iOS 26's glass header, the header's height under an opaque one. The home
    // indicator's inset sits outside the avoiding view so the keyboard never counts it twice.
    <View ref={frame} style={{ flex: 1, paddingBottom: insets.bottom }} onLayout={() => frame.current?.measureInWindow((_x, y) => setTop(y))}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={top}>
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[column, { padding: space.lg, gap: space.lg }]}
          onContentSizeChange={(_w, h) => {
            size.current.content = h;
            toEnd(false);
          }}
          // The view shrinks when the keyboard opens; keep the latest event above the composer, as Messages does.
          onLayout={(e) => {
            size.current.view = e.nativeEvent.layout.height;
            toEnd(true);
          }}
        >
          {/* The Agent's name with what it is doing under it, so the state stays in view however far the log scrolls. */}
          <Stack.Screen
            options={{
              title: agentName,
              headerTitle: () => (
                <View style={{ alignItems: "center" }}>
                  <Text variant="headline" numberOfLines={1}>
                    {agentName}
                  </Text>
                  <TaskStatus status={status} variant="caption" />
                </View>
              ),
            }}
          />
          <View style={{ alignItems: "center", gap: space.xs, paddingBottom: space.sm }}>
            <Character color={agent.color} status={status} size={56} />
            <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
              {task.title}
            </Text>
            <Text variant="caption" tone="secondary">
              {agent.machine.name} · {ago(task.events[0]?.at ?? now, now)}
            </Text>
          </View>
          {items(task.events).map((item) =>
            item.kind === "tools" ? <ToolCalls key={item.calls[0].seq} calls={item.calls} results={results} /> : render(item.event),
          )}
          {status === "working" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ActivityIndicator size="small" />
              <Text variant="footnote" tone="secondary">
                กำลังทำงาน…
              </Text>
            </View>
          )}
        </ScrollView>
        <Composer agent={agentName} taskId={taskId} busy={turnOpen(task.events)} inputRef={input} />
      </KeyboardAvoidingView>
    </View>
  );
}
