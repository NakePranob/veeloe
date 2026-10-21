import { Link, router, useLocalSearchParams } from "expo-router";
import { ArrowUp, Check, ChevronLeft, ChevronRight, CloudOff, PanelRight, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgent } from "@/src/entities/agent";
import { agentState, markRead, send, StateDot, stateLabel, useTask, useTasks, type Message, type TaskState } from "@/src/entities/task";
import { t } from "@/src/shared/i18n";
import { cn, usePanel, useWide } from "@/src/shared/lib";
import { Button, Character, Icon, Text } from "@/src/shared/ui";
import { ApprovalCard } from "./ApprovalCard";

function MessageView({ message, showBy }: { message: Message; showBy: boolean }) {
  const tasks = useTasks();
  if (message.kind === "me")
    return (
      <View className="max-w-[80%] items-end gap-1 self-end">
        <View className="bg-me rounded-[20px] rounded-br-md px-3.5 py-2.5">
          <Text className="text-me-foreground">{message.text}</Text>
        </View>
        {message.queued && <Text className="text-waiting text-xs font-medium">{t("composer.queued")}</Text>}
      </View>
    );
  if (message.kind === "agent")
    return (
      <View className="gap-0.5">
        {showBy && <Text className="text-muted-foreground text-xs font-semibold">{message.by}</Text>}
        <Text className="leading-6">{message.text}</Text>
      </View>
    );
  if (message.kind === "note")
    return (
      <View className="flex-row items-center gap-2">
        <Icon as={message.tone === "done" ? Check : X} className={cn("size-4", message.tone === "done" ? "text-done" : "text-destructive")} />
        <Text className="text-muted-foreground text-[15px]">
          {message.tone === "done" ? t("approval.approved") : t("approval.denied")} <Text className="text-muted-foreground font-mono text-sm">{message.text}</Text>
        </Text>
      </View>
    );
  return <Delegation message={message} state={tasks.find((task) => task.id === message.task)?.state ?? "idle"} />;
}

function Delegation({ message, state: childState }: { message: Extract<Message, { kind: "delegation" }>; state: TaskState }) {
  const child = useAgent(message.agent);
  return (
    <Link href={`/agents/${message.agent}/tasks/${message.task}`} asChild>
      <Pressable className="bg-secondary active:bg-accent flex-row items-center gap-3 rounded-2xl px-3.5 py-3">
        {child && <Character character={child.character} mood={childState === "working" ? "working" : "happy"} size={36} />}
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold">
            {message.agent} · {message.title}
          </Text>
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {t("delegation.subtask", { machine: message.machine })}
          </Text>
        </View>
        <Text className={cn("text-muted-foreground text-xs", childState === "done" && "text-done")}>{stateLabel(childState)}</Text>
        <Icon as={ChevronRight} className="text-muted-foreground size-4" />
      </Pressable>
    </Link>
  );
}

function Composer({ taskId, agent }: { taskId: string; agent: string }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    send(taskId, text.trim());
    setText("");
  };
  // The composer floats over the stream, so it is the one in-page element with a shadow (none in dark).
  return (
    <View className="border-border bg-card mx-auto w-full max-w-[720px] flex-row items-center gap-2 rounded-full border py-1 pr-1 pl-4 shadow-sm shadow-black/10 dark:shadow-none">
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder={t("composer.placeholder", { agent })}
        className="text-foreground placeholder:text-muted-foreground min-h-11 flex-1 text-base outline-none"
        accessibilityLabel={t("composer.placeholder", { agent })}
        returnKeyType="send"
      />
      <Button size="icon" className="rounded-full" onPress={submit} accessibilityLabel={t("composer.send")}>
        <Icon as={ArrowUp} className="text-primary-foreground size-5" />
      </Button>
    </View>
  );
}

export function TaskPage() {
  const { agent: agentId, task: taskId } = useLocalSearchParams<{ agent: string; task: string }>();
  const agent = useAgent(agentId);
  const task = useTask(taskId);
  const tasks = useTasks();
  const wide = useWide();
  const panel = usePanel();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => markRead(taskId), [taskId]);
  if (!agent || !task) return null;

  const { state, mood } = agentState(tasks, agent.id, agent.machine.online);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const pending = task.approval && !task.approval.answer;
  const parent = tasks.find((candidate) => candidate.id === task.parent);

  return (
    <KeyboardAvoidingView className="bg-background flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="border-border flex-row items-center gap-1 border-b px-2 pb-1.5" style={{ paddingTop: insets.top + 6 }}>
        {!wide && (
          <Button variant="ghost" size="icon" onPress={back} accessibilityLabel={t("back")}>
            <Icon as={ChevronLeft} className="size-6" />
          </Button>
        )}
        <Pressable
          className="active:bg-accent min-w-0 flex-1 flex-row items-center gap-2.5 rounded-xl px-1 py-1.5"
          onPress={wide ? panel.toggle : () => router.push(`/agents/${agent.id}?task=${task.id}`)}
          accessibilityLabel={t("details")}
        >
          <Character character={agent.character} mood={mood} size={36} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-semibold">
              {agent.id} <Text className="text-muted-foreground font-normal">· {task.title}</Text>
            </Text>
            <View className="flex-row items-center gap-1.5">
              <StateDot state={state} />
              <Text className="text-muted-foreground text-xs">{stateLabel(state)}</Text>
            </View>
          </View>
          {!wide && <Icon as={ChevronRight} className="text-muted-foreground size-4" />}
        </Pressable>
        {wide && (
          <Button variant={panel.open ? "secondary" : "ghost"} size="icon" onPress={panel.toggle} accessibilityLabel={t("details")}>
            <Icon as={PanelRight} className="size-[18px]" />
          </Button>
        )}
      </View>

      <ScrollView ref={scroll} className="flex-1" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <View className="mx-auto w-full max-w-[720px] gap-4 px-4 py-5">
          {parent && (
            <Link href={`/agents/${parent.agent}/tasks/${parent.id}`} asChild>
              <Pressable className="bg-secondary active:bg-accent self-start rounded-full px-3 py-1">
                <Text className="text-muted-foreground text-xs">
                  {parent.agent} · {parent.title}
                </Text>
              </Pressable>
            </Link>
          )}
          {task.messages.map((message, i) => {
            const before = task.messages[i - 1];
            const showBy = message.kind === "agent" && !(before?.kind === "agent" && before.by === message.by);
            return <MessageView key={i} message={message} showBy={showBy} />;
          })}
          {pending && task.approval && <ApprovalCard taskId={task.id} agent={agent.id} approval={task.approval} />}
        </View>
      </ScrollView>

      <View className="px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 14) }}>
        {agent.machine.online ? (
          <Composer taskId={task.id} agent={agent.id} />
        ) : (
          <View className="flex-row items-center justify-center gap-2 py-2">
            <Icon as={CloudOff} className="text-muted-foreground size-4" />
            <Text className="text-muted-foreground text-center text-sm">{t("task.offline", { machine: agent.machine.id })}</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
